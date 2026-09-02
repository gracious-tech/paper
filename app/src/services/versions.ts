
import {reactive, ref, computed} from 'vue'
import {cloneDeep} from 'lodash-es'
import {collection, doc, query, where, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc,
    updateDoc, deleteDoc, serverTimestamp, Timestamp} from 'firebase/firestore'
import type {DocumentData, Unsubscribe} from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getDownloadURL} from 'firebase/storage'
import {PDFDocument} from 'pdf-lib'
import {SCHEMA_VERSION, PDF_LIFETIME_MS} from 'paper-bible-typst'

import {firestore, firebase_storage} from '@/services/firebase'
import {api, ApiError} from '@/services/api'
import {user} from '@/services/auth'
import {designs, current_design_id} from '@/services/designs'
import {bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {custom_fonts, get_custom_font_styles, plan_version_fonts, upload_version_fonts,
    load_font_from_meta} from '@/services/custom_fonts'
import {plan_version_cover, render_cover_pdf} from '@/services/cover'
import {plan_version_images} from '@/services/content_images'
import {generate_token} from '@/services/utils'
import {report_error, error_to_string} from '@/services/errors'

import type {CustomFont} from 'typst-fonts'
import type {Blueprint, DesignMeta, Version} from '@/services/types'


let unsub_list:Unsubscribe|null = null


// The open design's rendered versions (scoped sync, re-subscribed whenever it changes)
export const versions = reactive([] as Version[])
export const selected_version_id = ref(null as string|null)
export const selected_version = computed(() => {
    return versions.find(item => item.id === selected_version_id.value)
})


// The most recently rendered version of the open design, if any
export const latest_version = computed(() => versions[0] ?? null)


// Whether the open design has no rendered version yet, or has unsaved/unrendered changes since
// its latest one — the condition ViewDesign.vue uses to decide editor-vs-version-list
export const design_needs_editor = computed(() => {
    const design = designs.find(item => item.id === current_design_id.value)
    if (!design){
        return true
    }
    return !latest_version.value || design.save_token !== latest_version.value.save_token
})


// Same condition as design_needs_editor, but usable for any row in the /designs list (not just
// the currently-open design) — reads the denormalized `latest_version` summary on the design doc
// instead of the live per-design `versions` subscription, which is only ever populated for the
// open design
export function design_needs_version(design:DesignMeta):boolean{
    return !design.latest_version || design.save_token !== design.latest_version.save_token
}


// A pending version is treated as stuck once it's sat this long past its latest compile attempt.
// That's well beyond any realistic compile time (the server fallback is capped near 5 min by the
// Cloud Run request timeout), so crossing it almost always means the compile's driver went away
// — the tab that clicked "Create" reloaded/closed/crashed, or the server instance was killed.
// `compile_and_upload` runs only in that one tab and nothing else ever advances a pending doc,
// so past this the UI offers a retry instead of an unbounded progress screen
export const STUCK_MS = 4 * 60 * 1000


export function version_stuck(version:Version):boolean{
    // Whether a pending version has been abandoned mid-compile (see STUCK_MS). Reads the wall
    // clock directly, so components re-run it against a ticking ref to keep the result current
    if (version.status !== 'pending'){
        return false
    }
    const since = (version.compile_started ?? version.created).getTime()
    return Date.now() - since > STUCK_MS
}


// --- List sync ------------------------------------------------------------------------------


function version_from_doc(id:string, data:DocumentData):Version{
    // Build a Version from its Firestore doc
    return {
        id,
        design_id: data['design_id'] as string,
        owner: data['owner'] as string,
        created: ((data['created'] ?? Timestamp.now()) as Timestamp).toDate(),
        compile_started: ((data['compile_started'] ?? null) as Timestamp|null)?.toDate() ?? null,
        title: data['title'] as string,
        blueprint: data['blueprint'] as Blueprint,
        status: data['status'] as Version['status'],
        cover_status: (data['cover_status'] ?? null) as Version['cover_status'],
        pages: (data['pages'] ?? null) as number|null,
        pdf_path: data['pdf_path'] as string,
        pdf_expires: ((data['pdf_expires'] ?? null) as Timestamp|null)?.toDate() ?? null,
        copied_from: (data['copied_from'] ?? null) as string|null,
        custom_fonts: (data['custom_fonts'] ?? []) as Version['custom_fonts'],
        save_token: data['save_token'] as string,
        error: (data['error'] ?? null) as string|null,
        error_id: (data['error_id'] ?? null) as string|null,
    }
}


export function start_versions_sync(design_id:string):void{
    // Keep the reactive `versions` list mirrored from Firestore, scoped to one design (most
    // recent first) — re-subscribes (tearing down the previous listener) as the open design
    // changes
    unsub_list?.()
    versions.splice(0, versions.length)
    unsub_list = onSnapshot(
        query(collection(firestore, 'versions'),
            where('design_id', '==', design_id), orderBy('created', 'desc')),
        snap => {
            versions.splice(0, versions.length, ...snap.docs.map(item => {
                return version_from_doc(item.id, item.data({serverTimestamps: 'estimate'}))
            }))
        },
        error => {
            report_error('banner', error)
        })
}


export async function fetch_latest_version_id(design_id:string):Promise<string|null>{
    // Look up the most recently rendered version of a design without needing edit access —
    // versions are publicly readable by id, and this query's result is no more revealing than
    // that (see ViewDesign.vue, which uses this to give a bare /designs/:id link read access
    // to a design's latest version, same as if the specific version link had been shared)
    const snap = await getDocs(query(collection(firestore, 'versions'),
        where('design_id', '==', design_id), orderBy('created', 'desc'), limit(1)))
    return snap.docs[0]?.id ?? null
}


// --- Generation -----------------------------------------------------------------------------


export async function create_pending_version(design_id:string, blueprint:Blueprint)
        :Promise<string>{
    // Freeze a blueprint into a new pending version doc and return its id. Any uploaded fonts
    // it references are snapshotted into the version's own Storage paths so regeneration never
    // depends on the user's mutable font library. Reads the parent design's save_token directly
    // (rather than trusting the `designs` list's own listener to have caught up yet) so the
    // freshly-created version's save_token is always the exact one the caller just flushed
    const id = generate_token()
    const design_snap = await getDoc(doc(firestore, 'designs', design_id))
    const save_token = design_snap.data()?.['save_token'] as string
    const fonts = plan_version_fonts(id, blueprint)
    // The cover's bg image is likewise snapshotted under the version's own Storage prefix
    // (the frozen blueprint's cover points at the snapshot path, not the mutable library)
    const cover = await plan_version_cover(id, blueprint)
    // Same snapshotting for any uploaded passage images referenced in the content list
    const images = await plan_version_images(id, blueprint)
    await setDoc(doc(firestore, 'versions', id), {
        schema: SCHEMA_VERSION,
        design_id,
        owner: user.value!.uid,
        created: serverTimestamp(),
        compile_started: serverTimestamp(),
        title: blueprint.title,
        blueprint: {...cloneDeep(blueprint), cover: cover.frozen, content: images.frozen},
        status: 'pending',
        pages: null,
        pdf_path: `versions/${id}/doc.pdf`,
        pdf_expires: null,
        copied_from: null,
        custom_fonts: fonts.meta,
        save_token,
        error: null,
        error_id: null,
    })
    // The version doc now exists but its asset uploads (and denormalized summary) haven't run —
    // if any fail here, the caller never gets `id` and compile_and_upload never runs for it, so
    // mark it failed rather than stranding it in 'pending' with nothing left to advance it
    try {
        // Denormalized onto the parent design doc so the /designs list can show status/needs-
        // attention chips without an N+1 per-design version query — see design_needs_version()
        await updateDoc(doc(firestore, 'designs', design_id),
            {latest_version: {status: 'pending', pages: null, save_token}})
        // Font/image bytes may only be uploaded once the doc exists (Storage rules resolve the
        // owner via the doc)
        await upload_version_fonts(fonts.uploads)
        for (const [path, bytes, content_type] of [...cover.uploads, ...images.uploads]){
            await uploadBytes(storage_ref(firebase_storage, path), bytes,
                {contentType: content_type})
        }
    } catch (error){
        await updateDoc(doc(firestore, 'versions', id),
            {status: 'failed', error: error_to_string(error)}).catch(() => undefined)
        throw error
    }
    return id
}


export async function compile_and_upload(id:string, design_id:string, blueprint:Blueprint,
        is_latest:boolean, fonts?:CustomFont[]):Promise<void>{
    // Compile a version's PDF in-browser and upload it, updating the doc's status. If the
    // in-browser compile fails (e.g. device lacks memory for large docs) fall back to compiling
    // server-side, which updates the doc itself.
    // `fonts` supplies a version's snapshotted custom fonts when regenerating (the live library
    // is used otherwise). `is_latest` gates the parent design's denormalized `latest_version`
    // summary — regenerating an older version must never clobber it with a stale status/pages
    const doc_ref = doc(firestore, 'versions', id)
    const design_ref = doc(firestore, 'designs', design_id)

    // Production URL for this exact version — woven into any auto-copyright block as a link + QR
    // code when the blueprint opts in (blueprint.design_link)
    const share_url = `${location.origin}/designs/${design_id}/${id}`

    // Stamp the start of this attempt so a reload/tab-close/crash mid-compile (or a killed
    // server fallback) can be spotted as stuck rather than shown as forever-pending — see
    // version_stuck(). Best-effort: a failed stamp write just means the older timestamp is used
    await updateDoc(doc_ref, {compile_started: serverTimestamp()}).catch(() => undefined)

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
            const request = await bible_content.resolve(
                blueprint, font_styles, undefined, share_url)

            // Compile in the worker (temporarily adding snapshotted fonts when regenerating),
            // then count pages for the history badge
            let bytes:Uint8Array
            if (fonts?.length){
                const families = new Set(fonts.map(f => f.family))
                await generator.set_custom_fonts(
                    [...custom_fonts.filter(f => !families.has(f.family)), ...fonts])
                try {
                    bytes = await generator.compile_pdf(request)
                } finally {
                    await generator.set_custom_fonts(custom_fonts)
                }
            } else {
                bytes = await generator.compile_pdf(request)
            }
            const pages = (await PDFDocument.load(bytes)).getPageCount()

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
            try {
                await api('/api/compile', {version_id: id})
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


export function version_expired(version:Version):boolean{
    // Whether the version's PDF has passed its Storage lifetime (metadata remains)
    return version.status === 'available'
        && version.pdf_expires !== null && version.pdf_expires.getTime() <= Date.now()
}


export function version_debug_ref(version:Version|null):string{
    // Identifying string for a version (host + id + saved error-report id) — shown to users to
    // quote in a support request, and prefilled into the "Contact us" link's description
    const error_part = version?.error_id ? ` error:${version.error_id}` : ''
    return location.hostname + ' version:' + (version?.id ?? '') + error_part
}


export function version_contact_url(version:Version|null):string{
    // "Contact us" link with the version's debug ref prefilled as the message description
    return 'https://gracious.tech/contact?desc=' + encodeURIComponent(version_debug_ref(version))
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
    await compile_and_upload(version.id, version.design_id, version.blueprint, is_latest, fonts)
}


export function cover_failed(version:Version):boolean{
    // Whether the version's interior is available but its wraparound cover failed to render —
    // the interior PDF can still be viewed/downloaded, the cover can't (and can be regenerated
    // on its own via regenerate_cover)
    return version.cover_status === 'failed' && version.status === 'available'
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
        const share_url = `${location.origin}/designs/${version.design_id}/${version.id}`
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
    const pages = (await PDFDocument.load(bytes)).getPageCount()

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
                const share_url = `${location.origin}/designs/${version.design_id}/${version.id}`
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
        fonts.length ? fonts : undefined)
}


// --- Access ---------------------------------------------------------------------------------


export async function get_pdf_url(version:Version):Promise<string|null>{
    // Resolve a download URL for the version's PDF, or null if it isn't (or is no longer)
    // available — a null for an 'available' version means the PDF expired
    if (version.status !== 'available' || version_expired(version)){
        return null
    }
    try {
        return await getDownloadURL(storage_ref(firebase_storage, version.pdf_path))
    } catch (error){
        // Object already lifecycle-deleted despite pdf_expires (clock skew/manual deletion)
        if ((error as {code?:string}).code === 'storage/object-not-found'){
            return null
        }
        throw error
    }
}


export async function get_cover_pdf_url(version:Version):Promise<string|null>{
    // Resolve a download URL for the version's separate cover PDF (path derived from the id,
    // never read from the doc — same rule as the server's pdf_path convention). Null when the
    // version has no cover, the cover render failed (cover_status), the version isn't available,
    // or the PDF expired (covers share doc.pdf's lifecycle — both under the same versions/ prefix)
    if (!version.blueprint.cover || version.cover_status === 'failed'
            || version.status !== 'available' || version_expired(version)){
        return null
    }
    try {
        return await getDownloadURL(
            storage_ref(firebase_storage, `versions/${version.id}/cover.pdf`))
    } catch (error){
        if ((error as {code?:string}).code === 'storage/object-not-found'){
            return null
        }
        throw error
    }
}


export async function open_version_pdf(win:Window|null, version:Version,
        which:'interior'|'cover'):Promise<void>{
    // Navigate an already-opened blank tab to one of the version's PDFs. The caller opens the
    // tab synchronously (passing the handle in) so popup blockers still credit the originating
    // click as a user gesture; this resolves the URL and points the tab at it, closing the tab
    // when the PDF isn't available (pending/failed/expired, or no cover)
    const url = which === 'cover' ? await get_cover_pdf_url(version) : await get_pdf_url(version)
    if (url && win){
        win.location.href = url
    } else {
        win?.close()
    }
}


export async function download_version_pdf(version:Version, which:'interior'|'cover')
        :Promise<void>{
    // Save one of the version's PDFs to disk. The stored objects have contentDisposition 'inline'
    // (so the preview iframe renders them) and live on a different origin, so the <a download>
    // attribute alone is ignored — fetch the bytes and hand the browser a same-origin blob URL
    const url = which === 'cover' ? await get_cover_pdf_url(version) : await get_pdf_url(version)
    if (!url){
        return
    }
    const blob = await (await fetch(url)).blob()
    const blob_url = URL.createObjectURL(blob)
    // Build a readable filename from the version title
    const base = (version.title || 'bible').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'bible'
    const name = which === 'cover' ? `${base} (cover).pdf` : `${base}.pdf`
    // Trigger the download via a transient anchor, then release the blob URL
    const anchor = document.createElement('a')
    anchor.href = blob_url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Give the browser a beat to start the download before releasing the blob
    setTimeout(() => URL.revokeObjectURL(blob_url), 10000)
}


export async function delete_version(id:string):Promise<void>{
    // Delete a version's metadata — its PDF object becomes unreachable immediately (Storage
    // rules can no longer resolve an owner) and is removed by the bucket's lifecycle rule
    await deleteDoc(doc(firestore, 'versions', id))
}


// --- Sharing --------------------------------------------------------------------------------


export async function fetch_shared_version(id:string):Promise<Version>{
    // Look up someone else's shared version directly — versions are publicly readable by id
    // (see firestore.rules), so the link itself is the whole capability, no token needed. Never
    // attempts to read the parent design doc, which stays gated to editors only
    const snap = await getDoc(doc(firestore, 'versions', id))
    if (!snap.exists()){
        throw new Error('not_found')
    }
    return version_from_doc(snap.id, snap.data())
}


export async function copy_version_to_new_design(id:string)
        :Promise<{design_id:string, version_id:string}>{
    // "Keep own copy": duplicate a shared version's design + PDF under the current user,
    // returning the new design and version ids (both appear in the user's own lists via sync)
    return await api<{design_id:string, version_id:string}>('/api/copy_version', {version_id: id})
}


export async function record_viewed(design_id:string, version_id:string, title:string)
        :Promise<void>{
    // Track that the user viewed someone else's design via a public version link, for the
    // /designs "Read access" section (they can copy it, not edit it)
    const uid = user.value!.uid
    await setDoc(doc(firestore, 'users', uid, 'viewed', design_id), {
        design_id, title, last_version_id: version_id, last_viewed: serverTimestamp(),
    }, {merge: true})
}


export async function has_viewed_design(design_id:string):Promise<boolean>{
    // Whether the user has already viewed this design before — a direct targeted read rather
    // than relying on the reactive `viewed_designs` list (designs.ts), which may not have
    // synced yet this early (DialogViewedDesign.vue uses this to only show the "Someone shared
    // this document with you" prompt the first time, not on every repeat visit)
    const uid = user.value!.uid
    const snap = await getDoc(doc(firestore, 'users', uid, 'viewed', design_id))
    return snap.exists()
}


export async function share_version(design_id:string, version_id:string)
        :Promise<'shared'|'copied'|'manual'>{
    // Share a version's public link, preferring the OS share sheet then the clipboard, only
    // falling back to a 'manual' result (caller shows a dialog to copy by hand) if neither
    // is available
    const url = `${location.origin}/designs/${design_id}/${version_id}`
    if (navigator.share){
        try {
            await navigator.share({url})
            return 'shared'
        } catch (error){
            // User cancelled -- they already saw the native share sheet, so nothing else to do
            if ((error as {name?:string}).name === 'AbortError'){
                return 'shared'
            }
        }
    }
    if (navigator.clipboard){
        try {
            await navigator.clipboard.writeText(url)
            return 'copied'
        } catch {
            // Fall through to manual dialog
        }
    }
    return 'manual'
}
