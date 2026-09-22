
// Turning a frozen version into a rendered PDF: the first compile, and every way back to one
// afterwards (regenerate an expired or failed render, re-render a failed cover on its own,
// retry a compile whose driver went away).
//
// Split from versions.ts, which owns the reactive list and everything that reads a version.
// This is the write side: it drives a version doc through pending → available/failed and
// publishes the objects behind it, so it depends on that module rather than the other way
// round. Two of the three paths are hybrid — compiled in this browser, falling back to
// /api/compile — and every one of them updates the parent design's denormalized
// `latest_version` summary, which is why they belong together rather than beside their callers.

import {cloneDeep} from 'lodash-es'
import {collection, doc, addDoc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp}
    from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getDownloadURL} from 'firebase/storage'
import {SCHEMA_VERSION, PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS} from 'paper-bible-typst'
import {RENDER_VERSION} from 'bookcover-core'

import {firestore, firebase_storage} from '@/services/firebase'
import {api, ApiError} from '@/services/api'
import {user} from '@/services/auth'
import {design_display_name} from '@/services/designs'
import {bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {custom_fonts, get_custom_font_styles, plan_version_fonts,
    load_font_from_meta} from '@/services/custom_fonts'
import {apply_asset_copies} from '@/services/design_assets'
import {plan_version_cover, render_cover_pdf} from '@/services/cover'
import {plan_version_images} from '@/services/content_images'
import {read_wizard_state} from '@/services/new_design'
import {generate_token} from '@/services/utils'
import {page_count_guess} from '@/services/state'
import {latest_version} from '@/services/versions'
import {report_error, error_to_string} from '@/services/errors'

import type {CustomFont} from 'typst-fonts'
import type {CompiledPdf} from '@/services/typst'
import type {Blueprint, Version} from '@/services/types'


export async function create_pending_version(design_id:string, blueprint:Blueprint)
        :Promise<{id:string, title:string}>{
    // Freeze a blueprint into a new pending version doc and return its id + frozen display name
    // (the caller passes that name back into the compile, for PDF metadata). Every uploaded
    // asset it references is snapshotted into the design's append-only version_assets prefix,
    // so regeneration never depends on what the live design still happens to reference. Reads
    // the parent design's save_token directly (rather than trusting the `designs` list's own
    // listener to have caught up yet) so the freshly-created version's save_token is always the
    // exact one the caller just flushed
    const version_id = generate_token()
    const design_snap = await getDoc(doc(firestore, 'designs', design_id))
    const save_token = design_snap.data()?.['save_token'] as string
    // The design's wizard state is frozen alongside the blueprint, from the same doc read and
    // under the same field names, so copying this version later can restore a simple design as
    // simple (see WizardState)
    const wizard = read_wizard_state(design_snap.data() ?? {})
    // The design's *resolved* name, frozen — a version is a snapshot of what was rendered, and
    // its name must not shift later when the design is renamed or its content changes.
    // name_auto comes from the same doc read as save_token above
    const title = design_display_name(
        blueprint, (design_snap.data()?.['name_auto'] ?? '') as string)
    // NOTE These take the *design* id, not the version id — snapshots are shared by every
    // version of a design, so re-rendering unchanged content moves no bytes at all
    const fonts = plan_version_fonts(design_id, blueprint)
    // The cover's bg image is likewise snapshotted into version_assets (the frozen blueprint's
    // cover points at the snapshot path, not at what the live design references)
    const cover = plan_version_cover(design_id, blueprint)
    // Same snapshotting for any uploaded passage images referenced in the content list
    const images = plan_version_images(design_id, blueprint)

    // Uploads first, doc second. Storage rules authorise version_assets writes against the
    // *design* doc, so nothing here depends on the version existing yet — and failing before
    // the doc is written leaves no version at all, rather than one stranded in 'pending' with
    // nothing left to advance it. The orphans a failed run leaves behind are content-addressed,
    // so the next attempt reuses them
    await apply_asset_copies([...fonts.copies, ...cover.copies, ...images.copies])

    await setDoc(doc(firestore, 'versions', version_id), {
        schema: SCHEMA_VERSION,
        design_id,
        owner: user.value!.uid,
        created: serverTimestamp(),
        compile_started: serverTimestamp(),
        title,
        blueprint: {...cloneDeep(blueprint), cover: cover.frozen, content: images.frozen},
        // What rendered this version's cover, frozen alongside the blueprint that describes it.
        // A version's PDFs expire after a year and are regenerated from the frozen blueprint,
        // possibly under a newer bookcover — recording this makes that drift detectable instead
        // of silent. null when the version has no cover. Deliberately only bookcover's own
        // version: the typst engine is pinned by exact dependency (see app/package.json and the
        // Dockerfile), and a hand-maintained copy of its version here would drift from the pin
        cover_render_version: cover.frozen ? RENDER_VERSION : null,
        status: 'pending',
        pages: null,
        pdf_path: `versions/${version_id}/doc.pdf`,
        pdf_expires: null,
        copied_from: null,
        custom_fonts: fonts.meta,
        save_token,
        ...wizard,
        error: null,
        error_id: null,
    })

    // Denormalized onto the parent design doc so the /designs list can show status/needs-
    // attention chips without an N+1 per-design version query — see design_needs_version().
    // Best-effort: the version itself is already valid and compilable, and a stale summary
    // only costs a wrong chip, so this must not fail the freeze
    await updateDoc(doc(firestore, 'designs', design_id),
        {latest_version: {status: 'pending', pages: null, save_token}})
        .catch((error:unknown) => {
            report_error('silent', error, {context: {stage: 'latest_version_summary'}})
        })

    return {id: version_id, title}
}


async function record_compile_stat(fields:{version_id:string, design_id:string, engine:'browser',
        interior_ms:number, pages:number|null, ok:boolean, estimated_pages:number|null,
        gutter_auto:boolean}):Promise<void>{
    // Log how long an interior compile took, plus which engine and browser ran it, to the
    // write-only compile_stats collection for offline performance analysis (never shown to the
    // user). Best-effort — telemetry must never interfere with a compile, so failures are
    // swallowed. The server records its own rows for the fallback path (see handle_compile).
    // `user` is always set here: a compile can only run for a signed-in user (anon included),
    // since freezing the version needs an owner.
    // estimated_pages is the pre-compile page-count guess that fed the auto binding-gutter;
    // paired with the actual `pages` it lets us judge offline whether the estimate is ever far
    // enough off to warrant a corrective recompile (see margin_gutter_auto). gutter_auto marks
    // the rows where that gap actually mattered
    try {
        await addDoc(collection(firestore, 'compile_stats'), {
            ...fields,
            owner: user.value!.uid,
            created: serverTimestamp(),
            // Firestore's TTL policy on this field drops the row after ~1 year (see
            // .bin/deploy_firebase); analysis only ever wants the recent window
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
            user_agent: navigator.userAgent,
        })
    } catch {
        // Ignore — losing a stat row doesn't matter
    }
}


export async function compile_and_upload(id:string, design_id:string, blueprint:Blueprint,
        is_latest:boolean, fonts?:CustomFont[], doc_name?:string):Promise<void>{
    // Compile a version's PDF in-browser and upload it, updating the doc's status. If the
    // in-browser compile fails (e.g. device lacks memory for large docs) fall back to compiling
    // server-side, which updates the doc itself.
    // `fonts` supplies a version's snapshotted custom fonts when regenerating (the live library
    // is used otherwise). `is_latest` gates the parent design's denormalized `latest_version`
    // summary — regenerating an older version must never clobber it with a stale status/pages
    const doc_ref = doc(firestore, 'versions', id)
    const design_ref = doc(firestore, 'designs', design_id)

    // Production URL for this exact version — woven into any auto-copyright block as a link + QR
    // code when the blueprint opts in (blueprint.design_link). Uses the short /v/:id form (just
    // the version id) rather than /designs/:design_id/:version so the printed link/QR stays short.
    // Hardcoded to the real domain (not location.origin) so a dev/preview compile still bakes a
    // working link/QR into the document — mirrors config.app_url on the server (compile.ts)
    const share_url = `https://paper.bible/v/${id}`

    // Stamp the start of this attempt so a reload/tab-close/crash mid-compile (or a killed
    // server fallback) can be spotted as stuck rather than shown as forever-pending — see
    // version_stuck(). Best-effort: a failed stamp write just means the older timestamp is used
    await updateDoc(doc_ref, {compile_started: serverTimestamp()}).catch(() => undefined)

    // Wall-clock of the interior compile (content resolve + Typst render), stamped for the
    // compile_stats telemetry — mirrors what the server times around compile_pdf_from_blueprint.
    // Stays null until the compile actually starts so the failure path only logs a real attempt
    let interior_start:number|null = null

    // Page-count guess passed to the resolver for the auto binding-gutter — captured here so the
    // same value reaches both the success and failure compile_stats rows (see record_compile_stat)
    const page_estimate = page_count_guess()

    try {
        try {
            // Resolve the frozen blueprint to a full request (fetches uncached Bible content)
            const generator = typst_generator.value
            if (!generator){
                throw new Error('Typst compiler not ready')
            }
            const font_styles = fonts
                ? Object.fromEntries(fonts.map(f => [f.family, f.style]))
                : get_custom_font_styles()
            interior_start = performance.now()
            const request = await bible_content.resolve(
                blueprint, font_styles, undefined, share_url, page_estimate, doc_name)

            // Compile in the worker (temporarily adding snapshotted fonts when regenerating).
            // The worker counts the pages for the history badge as it goes, so the PDF is never
            // parsed a second time on this thread
            let compiled:CompiledPdf
            if (fonts?.length){
                const families = new Set(fonts.map(f => f.family))
                await generator.set_custom_fonts(
                    [...custom_fonts.filter(f => !families.has(f.family)), ...fonts])
                try {
                    compiled = await generator.compile_pdf(request)
                } finally {
                    await generator.set_custom_fonts(custom_fonts)
                }
            } else {
                compiled = await generator.compile_pdf(request)
            }
            const interior_ms = performance.now() - interior_start
            const {bytes, pages} = compiled

            // Record the successful in-browser compile for offline performance analysis
            void record_compile_stat({
                version_id: id, design_id, engine: 'browser', interior_ms, pages, ok: true,
                estimated_pages: page_estimate, gutter_auto: blueprint.margin_gutter_auto})

            // Publish the PDF, then mark the version available (contentDisposition: 'inline' so
            // the iframe preview displays it rather than triggering a download — the Storage
            // emulator defaults to 'attachment' when it's left unset, unlike production)
            await uploadBytes(storage_ref(firebase_storage, `versions/${id}/doc.pdf`),
                bytes, {contentType: 'application/pdf', contentDisposition: 'inline'})

            // Render + publish the cover as its own separate PDF (a wraparound cover is a
            // different page size and print services take it as its own file). Rendered after
            // the interior deliberately — its spine width derives from the actual page count
            // just compiled. A cover failure is non-fatal: the interior is already compiled and
            // uploaded, so record cover_status 'failed' and still publish the version (the UI
            // disables just the cover's view/download, and offers a cover-only regen)
            let cover_status:Version['cover_status'] = null
            if (blueprint.cover){
                try {
                    const cover_bytes = await render_cover_pdf(blueprint, pages, fonts, share_url)
                    await uploadBytes(storage_ref(firebase_storage, `versions/${id}/cover.pdf`),
                        cover_bytes, {contentType: 'application/pdf', contentDisposition: 'inline'})
                    cover_status = 'available'
                } catch (cover_error){
                    report_error('silent', cover_error,
                        {context: {version_id: id, stage: 'cover_render'}})
                    cover_status = 'failed'
                }
            }

            await updateDoc(doc_ref, {
                status: 'available',
                cover_status,
                pages,
                pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
                error: null,
            })
            if (is_latest){
                await updateDoc(design_ref,
                    {'latest_version.status': 'available', 'latest_version.pages': pages})
            }
        } catch (wasm_error){
            // In-browser path failed — hand over to the server (status updates then arrive
            // via the versions Firestore sync). Not critical yet as the fallback usually works
            report_error('silent', wasm_error,
                {context: {version_id: id, stage: 'wasm_compile'}})
            // Log the failed in-browser attempt (only if the compile itself was reached) so the
            // telemetry shows browser-vs-server splits and how long a device struggles before
            // giving up; the server records its own row for the fallback that follows
            if (interior_start !== null){
                void record_compile_stat({version_id: id, design_id, engine: 'browser',
                    interior_ms: performance.now() - interior_start, pages: null, ok: false,
                    estimated_pages: page_estimate, gutter_auto: blueprint.margin_gutter_auto})
            }
            try {
                await api('/api/compile', {version_id: id, page_count: page_estimate})
            } catch (server_error){
                // A concurrent compile (another tab, or a retry racing the original) already
                // moved the version out of 'pending' — not a failure, the winner's status
                // arrives via the versions sync
                if (server_error instanceof ApiError
                        && ['not_pending', 'compile_in_progress'].includes(server_error.code)){
                    return
                }
                throw server_error
            }
        }
    } catch (error){
        // Even the server fallback failed (it records its own failures — this catch covers
        // not being able to reach it at all). Record the report's id on the doc so the failed
        // view can offer a support link containing it
        const error_id = report_error('silent', error,
            {force: true, critical: true, context: {version_id: id, stage: 'compile_fallback'}})
        // Only clobber the status if this version is still pending — a concurrent winner may
        // have set it 'available' while this attempt was failing
        const current = (await getDoc(doc_ref).catch(() => null))?.data()?.['status']
        if (current !== undefined && current !== 'pending'){
            return
        }
        await updateDoc(doc_ref, {status: 'failed', error: error_to_string(error), error_id})
            .catch((update_error:unknown) => {
                report_error('banner', update_error)
            })
        if (is_latest){
            await updateDoc(design_ref, {'latest_version.status': 'failed'})
                .catch((update_error:unknown) => {
                    report_error('banner', update_error)
                })
        }
    }
}



export async function regenerate_version(version:Version):Promise<void>{
    // Recompile an expired/failed version's PDF from its frozen blueprint and font snapshot
    // NOTE Storage rules only allow (re)creating the object when it no longer exists
    if (version.status === 'pending'){
        return
    }
    const fonts = await Promise.all(version.custom_fonts.map(meta => load_font_from_meta(meta)))
    // Only the design's actual latest version may update its denormalized summary — regenerating
    // an older/expired one must never clobber it with a stale status/pages
    const is_latest = latest_version.value?.id === version.id
    await updateDoc(doc(firestore, 'versions', version.id), {status: 'pending', error: null})
    if (is_latest){
        await updateDoc(doc(firestore, 'designs', version.design_id),
            {'latest_version.status': 'pending'})
    }
    await compile_and_upload(version.id, version.design_id, version.blueprint, is_latest, fonts,
        version.title)
}


export async function regenerate_cover(version:Version):Promise<void>{
    // Re-render just the cover for a version whose interior succeeded but whose cover failed.
    // Far cheaper than regenerate_version (no interior recompile) and it sidesteps the
    // create-once doc.pdf a full recompile would 403 on — only the absent cover.pdf is produced
    if (!version.blueprint.cover || version.status !== 'available'){
        return
    }
    const doc_ref = doc(firestore, 'versions', version.id)
    try {
        const fonts = await Promise.all(
            version.custom_fonts.map(meta => load_font_from_meta(meta)))
        const share_url = `https://paper.bible/v/${version.id}`
        const cover_bytes = await render_cover_pdf(version.blueprint, version.pages ?? 0,
            fonts.length ? fonts : undefined, share_url)
        await uploadBytes(storage_ref(firebase_storage, `versions/${version.id}/cover.pdf`),
            cover_bytes, {contentType: 'application/pdf', contentDisposition: 'inline'})
        await updateDoc(doc_ref, {cover_status: 'available'})
    } catch (error){
        report_error('banner', error, {context: {version_id: version.id, stage: 'cover_regen'}})
        await updateDoc(doc_ref, {cover_status: 'failed'}).catch(() => undefined)
    }
}


async function adopt_pending_pdf(version:Version, is_latest:boolean):Promise<boolean>{
    // If a prior compile of this pending version already uploaded its PDF but died before
    // recording the result, finish the job from the bytes that are already in Storage rather
    // than recompiling — the client can't overwrite doc.pdf (create-once) anyway, so a re-upload
    // would only 403 into the server fallback. Returns false if there's no PDF to adopt
    let url:string
    try {
        url = await getDownloadURL(
            storage_ref(firebase_storage, `versions/${version.id}/doc.pdf`))
    } catch (error){
        if ((error as {code?:string}).code === 'storage/object-not-found'){
            return false
        }
        throw error
    }
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    // Counted in the Typst worker (which owns pdf-lib) — this needs no compiler, so it still
    // works on a device whose WASM init failed
    const generator = typst_generator.value
    if (!generator){
        throw new Error('Typst compiler not ready')
    }
    const pages = await generator.page_count(bytes)

    // The cover PDF is uploaded after the interior, so it can be missing even when doc.pdf isn't
    // — render + upload just the cover in that case (cover.pdf is also create-once, but absent).
    // A cover failure here is non-fatal, same as the main compile path: adopt the interior and
    // record cover_status 'failed'
    let cover_status:Version['cover_status'] = null
    if (version.blueprint.cover){
        let cover_missing = false
        try {
            await getDownloadURL(
                storage_ref(firebase_storage, `versions/${version.id}/cover.pdf`))
        } catch (error){
            if ((error as {code?:string}).code !== 'storage/object-not-found'){
                throw error
            }
            cover_missing = true
        }
        cover_status = 'available'
        if (cover_missing){
            try {
                const fonts = await Promise.all(
                    version.custom_fonts.map(meta => load_font_from_meta(meta)))
                const share_url = `https://paper.bible/v/${version.id}`
                const cover_bytes = await render_cover_pdf(
                    version.blueprint, pages, fonts.length ? fonts : undefined, share_url)
                await uploadBytes(
                    storage_ref(firebase_storage, `versions/${version.id}/cover.pdf`),
                    cover_bytes, {contentType: 'application/pdf', contentDisposition: 'inline'})
            } catch (cover_error){
                report_error('silent', cover_error,
                    {context: {version_id: version.id, stage: 'cover_render'}})
                cover_status = 'failed'
            }
        }
    }

    await updateDoc(doc(firestore, 'versions', version.id), {
        status: 'available',
        cover_status,
        pages,
        pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
        error: null,
    })
    if (is_latest){
        await updateDoc(doc(firestore, 'designs', version.design_id),
            {'latest_version.status': 'available', 'latest_version.pages': pages})
    }
    return true
}


export async function retry_version(version:Version):Promise<void>{
    // Re-drive a version that's been stuck in 'pending' past STUCK_MS back through the compile
    // pipeline (see version_stuck). Unlike regenerate_version this deliberately accepts a pending
    // version — it's the recovery path for one whose original compile never finished (tab
    // reload/close/crash, killed server instance)
    if (version.status !== 'pending'){
        return
    }
    const is_latest = latest_version.value?.id === version.id
    // The PDF may already be sitting in Storage (upload landed but the status write didn't) —
    // adopt it instead of recompiling
    if (await adopt_pending_pdf(version, is_latest)){
        return
    }
    const fonts = await Promise.all(version.custom_fonts.map(meta => load_font_from_meta(meta)))
    await updateDoc(doc(firestore, 'versions', version.id), {error: null})
    await compile_and_upload(version.id, version.design_id, version.blueprint, is_latest,
        fonts.length ? fonts : undefined, version.title)
}
