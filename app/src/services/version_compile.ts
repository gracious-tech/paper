
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
import {collection, doc, addDoc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
    Timestamp, onSnapshot} from 'firebase/firestore'
import type {DocumentReference} from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getDownloadURL} from 'firebase/storage'
import {SCHEMA_VERSION, PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS} from 'paper-bible-typst'
import {RENDER_VERSION} from 'bookcover-core'

import {firestore, firebase_storage} from '@/services/firebase'
import {api, ApiError, ApiOfflineError} from '@/services/api'
import {user} from '@/services/auth'
import {design_display_name, current_design_id, gen_name_auto} from '@/services/designs'
import {bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {is_mobile_now} from '@/services/display'
import {plan_version_fonts, fonts_for_blueprint, load_font_from_meta}
    from '@/services/custom_fonts'
import {apply_asset_copies} from '@/services/design_assets'
import {plan_version_cover, render_cover_pdf} from '@/services/cover'
import {plan_version_images} from '@/services/content_images'
import {read_wizard_state} from '@/services/new_design'
import {version_missing_bibles, version_retryable, compiling_on_server, STUCK_MS}
    from '@/services/versions'
import {page_count_guess, DEFAULT_PAGE_GUESS, alert_dialog} from '@/services/state'
import {translate} from '@/services/i18n'
import {report_error, error_to_string} from '@/services/errors'
import {version_progress, build_requests, hold_page, claim_compile_turn, compiling_here}
    from '@/services/compile_progress'
import {retry_network} from '@/services/network_retry'
import {compiles_on_server, is_device_failure, switch_to_server, switch_provisional,
    settle_server_mode, begin_browser_job} from '@/services/compile_mode'

import type {CustomFont} from 'typst-fonts'
import type {Blueprint, Version} from '@/services/types'
import type {CompileProgress} from '@/services/compile_progress'


// What compile_and_upload needs to render one version. Everything that could otherwise be read
// from the open design's live state (its custom fonts, its preview's page estimate) is passed in
// explicitly, since a compile outlives the page it was started from — the user can open another
// design, or start a second compile, long before this one is done
export interface VersionCompileJob {
    id:string
    design_id:string
    // The frozen blueprint
    blueprint:Blueprint
    // The version's save_token, which decides whether it may still update the parent design's
    // denormalized `latest_version` summary (see update_latest_summary)
    save_token:string
    // The only custom fonts the compile sees: the live ones the version froze, or its snapshot
    // when regenerating
    fonts:CustomFont[]
    // Page-count guess for the auto binding-gutter (see margin_gutter_auto), or how to work one
    // out once the compile's turn comes (see claim_compile_turn), since that's a compile too
    page_estimate:number|(() => Promise<number>)
    // The version's frozen display name, embedded as PDF metadata
    title:string
}


export async function create_pending_version(design_id:string, blueprint:Blueprint,
        version_id:string, page_estimate:VersionCompileJob['page_estimate'],
        save_token:string|null):Promise<VersionCompileJob>{
    // Freeze a blueprint into a new pending version doc (under version_id, which the caller
    // already showed the user) and return the job that compiles it (pass it straight to
    // compile_and_upload). Every uploaded asset it references is
    // snapshotted into the design's append-only version_assets prefix, so regeneration never
    // depends on what the live design still happens to reference.
    // save_token is null when the blueprint is the design as it's persisted now: the version then
    // takes the design's own, read from its doc directly (rather than trusting the `designs`
    // list's own listener to have caught up yet) so it's always the exact one the caller just
    // flushed. A blueprint the design has since moved on from is given one of its own instead,
    // which no state of the design matches (see design_needs_editor)

    // Everything read from the open design's live state is captured before the first await, while
    // it's still certainly this design that's open (see VersionCompileJob)
    // NOTE These take the *design* id, not the version id — snapshots are shared by every
    // version of a design, so re-rendering unchanged content moves no bytes at all
    const fonts = plan_version_fonts(design_id, blueprint)
    // The cover's bg image is likewise snapshotted into version_assets (the frozen blueprint's
    // cover points at the snapshot path, not at what the live design references)
    const cover = plan_version_cover(design_id, blueprint)
    // Same snapshotting for any uploaded passage images referenced in the content list
    const images = plan_version_images(design_id, blueprint)
    const compile_fonts = fonts_for_blueprint(blueprint)

    const design_snap = await getDoc(doc(firestore, 'designs', design_id))
    const own_state = save_token === null
    save_token ??= design_snap.data()?.['save_token'] as string
    // The design's wizard state is frozen alongside the blueprint, from the same doc read and
    // under the same field names, so copying this version later can restore a simple design as
    // simple (see WizardState)
    const wizard = read_wizard_state(design_snap.data() ?? {})
    // The design's *resolved* name, frozen — a version is a snapshot of what was rendered, and
    // its name must not shift later when the design is renamed or its content changes.
    // name_auto comes from the same doc read as save_token above, while it describes the
    // blueprint being frozen
    const name_auto = own_state ? (design_snap.data()?.['name_auto'] ?? '') as string
        : gen_name_auto(blueprint)
    const title = design_display_name(blueprint, name_auto)

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

    return {id: version_id, design_id, blueprint, save_token, fonts: compile_fonts,
        page_estimate, title}
}


async function update_latest_summary(design_id:string, save_token:string,
        fields:Record<string, unknown>):Promise<void>{
    // Update the parent design's denormalized `latest_version` summary, but only while this
    // version is still the design's latest — decided when the write happens, not when the compile
    // started, since a newer version may have been created meanwhile (it overwrites the summary's
    // save_token with its own). The same test the server applies in handle_compile, inside a
    // transaction so a newer version landing between the read and the write can't be clobbered.
    // Best-effort, like the summary write in create_pending_version: the version itself is
    // already recorded, and a stale summary only costs a wrong chip on /designs
    const design_ref = doc(firestore, 'designs', design_id)
    try {
        await runTransaction(firestore, async transaction => {
            const summary = (await transaction.get(design_ref)).data()?.['latest_version'] as
                {save_token?:string}|null|undefined
            if (summary?.save_token === save_token){
                transaction.update(design_ref, fields)
            }
        })
    } catch (error){
        report_error('silent', error, {context: {stage: 'latest_version_summary'}})
    }
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
            // .bin/deploy_firebase_initial); analysis only ever wants the recent window
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
            user_agent: navigator.userAgent,
        })
    } catch {
        // Ignore — losing a stat row doesn't matter
    }
}


function api_unreachable(error:unknown):boolean{
    // Whether an API call failed without the server deciding anything: it never got there, or
    // the gateway/server couldn't take it just then (a failed dispatch releases its lock first,
    // and a repeat of a request that did get through is answered `not_pending`)
    return error instanceof ApiOfflineError
        || (error instanceof ApiError && [500, 502, 503, 504].includes(error.status))
}


function upload_unreachable(error:unknown):boolean{
    // Whether an upload failed for want of a connection. The Storage SDK already retries those
    // itself for maxUploadRetryTime (10 min) before giving up with this code; anything else
    // (above all a refused create-once object) is final
    return (error as {code?:string}).code === 'storage/retry-limit-exceeded' || !navigator.onLine
}


async function upload_pdf(version_id:string, name:'doc'|'cover', bytes:Uint8Array)
        :Promise<void>{
    // Publish one of a version's PDFs, waiting out a lost connection rather than losing the
    // compiled bytes (contentDisposition 'inline' so the iframe preview displays it rather than
    // triggering a download — the Storage emulator defaults to 'attachment' when it's left unset,
    // unlike production)
    const target = storage_ref(firebase_storage, `versions/${version_id}/${name}.pdf`)
    await retry_network(() => uploadBytes(target, bytes,
        {contentType: 'application/pdf', contentDisposition: 'inline'}),
        upload_unreachable, version_id)
}


// How long to keep asking for a server compile while the server is busy with another of this
// user's compiles, and how long to wait between asks
const SERVER_BUSY_WAIT_MS = 3 * 60 * 1000
const SERVER_BUSY_RETRY_MS = 10 * 1000


async function request_server_compile(id:string, page_estimate:number|null, cover_only = false)
        :Promise<void>{
    // Hand a pending version over to the server compile (or, cover_only, a published version's
    // pending cover). The server answers as soon as it has accepted the job, and the compile
    // records its outcome on the version doc itself (it arrives here via the versions sync).
    // Only throws when the server couldn't be got to take the job, a lost connection included
    // only once it's been given every chance to come back (see retry_network)
    const give_up_at = Date.now() + SERVER_BUSY_WAIT_MS
    while (true){
        try {
            await retry_network(() => api('/api/compile', {version_id: id,
                ...page_estimate !== null && {page_count: page_estimate},
                ...cover_only && {cover_only}}), api_unreachable, id)
            return
        } catch (error){
            if (!(error instanceof ApiError)){
                throw error
            }

            // A concurrent compile (another tab, or a retry racing the original) already moved
            // the version out of 'pending' or is compiling it now — not a failure, the winner's
            // status arrives via sync
            if (error.code === 'not_pending'){
                return
            }

            // The server is busy with another of this user's compiles (e.g. a second design
            // falling back at the same time) and hasn't touched this version — wait for a turn
            // rather than leaving it pending with nothing left to drive it
            if (error.code === 'compile_in_progress' && Date.now() < give_up_at){
                await new Promise(resolve => setTimeout(resolve, SERVER_BUSY_RETRY_MS))
                continue
            }

            throw error
        }
    }
}


async function render_cover_here(id:string, blueprint:Blueprint, pages:number,
        load_fonts:() => Promise<CustomFont[]>, stage:string):Promise<'available'|'pending'>{
    // Render a version's cover in this browser (with the custom fonts load_fonts gives) and
    // publish it. When that fails it's reported and 'pending' returned, for the caller to record
    // before handing the cover to the server (see finish_cover_on_server)

    // A device that builds on the server leaves its covers to it too (see compile_mode.ts)
    if (compiles_on_server()){
        return 'pending'
    }

    // A phone may not hold the cover's compiler beside the book's, which still has the whole
    // interior in memory, so free that first (it respawns lean for the next compile)
    if (is_mobile_now()){
        typst_generator.value?.release_memory()
    }
    try {
        const cover_bytes = await render_cover_pdf(blueprint, pages, 'final', await load_fonts(),
            `https://paper.bible/v/${id}`)
        await upload_pdf(id, 'cover', cover_bytes)
        return 'available'
    } catch (error){
        report_error('silent', error, {context: {version_id: id, stage}})
        return 'pending'
    }
}


// The doc fields that record a cover handed to the server. compile_started is restamped so the
// handover is timed from now (see cover_stuck), not from the interior compile before it
function cover_status_fields(status:'available'|'pending'):Record<string, unknown>{
    return status === 'pending'
        ? {cover_status: 'pending', compile_started: serverTimestamp()}
        : {cover_status: 'available'}
}


async function load_version_fonts(version:Version):Promise<CustomFont[]>{
    // Load a version's snapshotted custom fonts (usually none)
    return await Promise.all(version.custom_fonts.map(meta => load_font_from_meta(meta)))
}


async function finish_cover_on_server(id:string):Promise<void>{
    // Have the server render a published version's cover, after the browser couldn't (the doc
    // already says cover_status 'pending'). The server records its own outcome, so only failing
    // to reach it at all is recorded here
    try {
        await request_server_compile(id, null, true)
    } catch (error){
        report_error('silent', error,
            {critical: true, context: {version_id: id, stage: 'cover_fallback'}})
        await updateDoc(doc(firestore, 'versions', id), {cover_status: 'failed'})
            .catch(() => undefined)
    }
}


// Thrown to skip a compile's browser attempt on a device that builds on the server
class ServerModeHandover extends Error {}


async function version_settled(doc_ref:DocumentReference):Promise<boolean>{
    // Whether a failing compile attempt has nothing left to do: the version was deleted, so both
    // the upload and the server fallback are refused (each needs its doc), or it's no longer
    // pending because another attempt (in this tab or another) published it first, so this one's
    // upload was refused by the create-once doc.pdf. False when the doc can't be read
    const snapshot = await getDoc(doc_ref).catch(() => null)
    if (!snapshot){
        return false
    }
    return !snapshot.exists() || snapshot.data()['status'] !== 'pending'
}


async function record_server_unreachable(doc_ref:DocumentReference, design_id:string,
        save_token:string, error:unknown):Promise<void>{
    // Mark a version failed when the server compile couldn't be reached at all (the server
    // records its own failures)
    // Nothing is left to fail if the version was deleted or published meanwhile, and its
    // status mustn't be clobbered by a loser of the race (see version_settled)
    if (await version_settled(doc_ref)){
        return
    }
    // Record the report's id on the doc so the failed view can offer a support link containing it
    const error_id = report_error('silent', error, {force: true, critical: true,
        context: {version_id: doc_ref.id, stage: 'compile_fallback'}})
    // Can't record the failure — the version stays pending until it reads as stuck, which
    // offers the user a retry anyway (see version_stuck)
    await updateDoc(doc_ref, {status: 'failed', error: error_to_string(error), error_id})
        .catch((update_error:unknown) => {
            report_error('silent', update_error,
                {context: {version_id: doc_ref.id, stage: 'compile_fallback_status'}})
        })
    await update_latest_summary(design_id, save_token, {'latest_version.status': 'failed'})
}


function settle_on_outcome(doc_ref:DocumentReference):void{
    // Settle a provisional switch to the server (see settle_server_mode) on the outcome of the
    // version just handed to it, once its doc says, giving up after STUCK_MS since a compile that
    // never reports back settles nothing
    let unsubscribe = () => {}
    const timer = setTimeout(() => unsubscribe(), STUCK_MS)
    unsubscribe = onSnapshot(doc_ref, snapshot => {
        const status = snapshot.data()?.['status'] as string|undefined
        if (status === 'available' || status === 'failed'){
            clearTimeout(timer)
            unsubscribe()
            settle_server_mode(status === 'available')
        }
    }, () => {
        clearTimeout(timer)
        unsubscribe()
    })
}


export async function compile_and_upload(job:VersionCompileJob,
        held_turn:(() => void)|null = null):Promise<void>{
    // Compile a version's PDF in-browser and upload it, updating the doc's status. If the
    // in-browser compile fails (e.g. device lacks memory for large docs) fall back to compiling
    // server-side, which updates the doc itself. Waits for this tab's compiler to be free first
    // (see claim_compile_turn), unless the caller already holds that turn and hands it over
    const {id, design_id, blueprint, save_token, fonts} = job

    // Warn before leaving the page until the in-browser part is over (released early on handing
    // off to the server, which finishes the compile whether or not this tab stays open)
    const release_page = hold_page()

    const doc_ref = doc(firestore, 'versions', id)

    // Production URL for this exact version — woven into any auto-copyright block as a link + QR
    // code when the blueprint opts in (blueprint.design_link). Uses the short /v/:id form (just
    // the version id) rather than /designs/:design_id/:version so the printed link/QR stays short.
    // Hardcoded to the real domain (not location.origin) so a dev/preview compile still bakes a
    // working link/QR into the document — mirrors config.app_url on the server (compile.ts)
    const share_url = `https://paper.bible/v/${id}`

    // Mark the version as compiling in this tab from the outset, before any progress arrives, so
    // it's never offered a retry while this attempt runs (see version_stuck)
    version_progress[id] = {stage: held_turn || !compiling_here.value ? 'start' : 'queued'}

    // Stamp the start of this attempt so a reload/tab-close/crash mid-compile (or a killed
    // server fallback) can be spotted as stuck rather than shown as forever-pending — see
    // version_stuck(). Best-effort: a failed stamp write just means the older timestamp is used
    await updateDoc(doc_ref, {compile_started: serverTimestamp()}).catch(() => undefined)

    // Released as soon as the browser's part is over, like release_page
    const release_turn = held_turn ?? await claim_compile_turn()
    const page_estimate = typeof job.page_estimate === 'number' ? job.page_estimate
        : await job.page_estimate()

    // Wall-clock of the interior compile (content resolve + Typst render), stamped for the
    // compile_stats telemetry — mirrors what the server times around compile_pdf_from_blueprint.
    // Stays null until the compile actually starts so the failure path only logs a real attempt
    let interior_start:number|null = null

    // Forwarded to both the content-fetching and PDF-compiling stages, so DisplayDesignVersion.vue
    // can show which passage is currently being downloaded/written (mirrors DisplayPreview.vue's
    // own on_progress). Cleared in the finally block below once this attempt is done
    const on_progress = (event:CompileProgress) => {
        version_progress[id] = event
    }

    // Ends the browser's part of this attempt once it started one (see below)
    let end_job = () => {}

    try {
        try {
            // A phone that can't cope compiles nothing itself (see compile_mode.ts), so the
            // version goes straight to the server, by the same path a failed compile falls back on
            if (compiles_on_server()){
                throw new ServerModeHandover()
            }

            // Resolve the frozen blueprint to a full request (fetches uncached Bible content)
            const generator = typst_generator.value
            if (!generator){
                throw new Error('Typst compiler not ready')
            }

            // The whole of the browser's part counts as running, not just the worker's compile:
            // fetching the content before it and holding and uploading the PDF after it can lose
            // a phone's tab as well (see begin_browser_job)
            end_job = begin_browser_job('build')
            const font_styles = Object.fromEntries(fonts.map(f => [f.family, f.style]))
            interior_start = performance.now()
            const request = await bible_content.resolve(
                blueprint, font_styles, on_progress, share_url, page_estimate, job.title)

            // Compile in the worker with exactly this version's fonts. The worker counts the
            // pages for the history badge as it goes, so the PDF is never parsed a second time
            // on this thread
            const {bytes, pages} = await generator.compile_pdf(request, on_progress, false, fonts)
            const interior_ms = performance.now() - interior_start

            // Record the successful in-browser compile for offline performance analysis
            void record_compile_stat({
                version_id: id, design_id, engine: 'browser', interior_ms, pages, ok: true,
                estimated_pages: page_estimate, gutter_auto: blueprint.margin_gutter_auto})

            // Publish the PDF, then mark the version available
            await upload_pdf(id, 'doc', bytes)

            // Render + publish the cover as its own separate PDF (a wraparound cover is a
            // different page size and print services take it as its own file). Rendered after
            // the interior deliberately — its spine width derives from the actual page count
            // just compiled. A cover failure doesn't hold up the interior: the version is
            // published with its cover 'pending', which the server then renders
            let cover:'available'|'pending'|null = null
            if (blueprint.cover){
                on_progress({stage: 'cover'})
                cover = await render_cover_here(id, blueprint, pages, async () => fonts,
                    'cover_render')
            }
            end_job()

            await updateDoc(doc_ref, {
                status: 'available',
                ...cover ? cover_status_fields(cover) : {cover_status: null},
                pages,
                pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
                error: null,
            })
            await update_latest_summary(design_id, save_token,
                {'latest_version.status': 'available', 'latest_version.pages': pages})
            if (cover === 'pending'){
                release_turn()
                await finish_cover_on_server(id)
            }
        } catch (wasm_error){
            end_job()
            // A refused upload may just mean another attempt got there first (see
            // version_settled), leaving nothing to fall back for
            if (await version_settled(doc_ref)){
                return
            }
            // In-browser path failed (or was skipped) — hand over to the server (status updates
            // then arrive via the versions Firestore sync). Not critical yet as the fallback
            // usually works
            if (!(wasm_error instanceof ServerModeHandover)){
                report_error('silent', wasm_error,
                    {context: {version_id: id, stage: 'wasm_compile'}})
            }
            // Log the failed in-browser attempt (only if the compile itself was reached) so the
            // telemetry shows browser-vs-server splits and how long a device struggles before
            // giving up; the server records its own row for the fallback that follows
            if (interior_start !== null){
                void record_compile_stat({version_id: id, design_id, engine: 'browser',
                    interior_ms: performance.now() - interior_start, pages: null, ok: false,
                    estimated_pages: page_estimate, gutter_auto: blueprint.margin_gutter_auto})
            }
            // A failure that was the device's own sends its compiles to the server from now on,
            // settled by how the server does with this one
            if (is_device_failure(wasm_error)){
                switch_to_server('memory')
            }
            release_page()
            release_turn()
            await request_server_compile(id, page_estimate)
            if (switch_provisional()){
                settle_on_outcome(doc_ref)
            }
        }
    } catch (error){
        await record_server_unreachable(doc_ref, design_id, save_token, error)
    } finally {
        // No more in-browser progress to show once this attempt is over, whether it succeeded,
        // was handed off to the server, or failed outright
        delete version_progress[id]
        end_job()
        release_page()
        release_turn()
    }
}



function recompile_page_estimate(version:Version):number{
    // The page count to size a recompile's preliminaries by. A version that compiled before knows
    // its real page count; one that never did can only borrow the preview's estimate, and only
    // when the design open now is its own (the estimate belongs to whichever design was last
    // previewed)
    const own_design_open = current_design_id.value === version.design_id
    return version.pages ?? (own_design_open ? page_count_guess() : DEFAULT_PAGE_GUESS)
}


function recompile_job(version:Version, fonts:CustomFont[]):VersionCompileJob {
    // Describe a recompile of an existing version from its frozen blueprint and font snapshot
    return {
        id: version.id,
        design_id: version.design_id,
        blueprint: version.blueprint,
        save_token: version.save_token,
        fonts,
        page_estimate: recompile_page_estimate(version),
        title: version.title,
    }
}


async function refuse_missing_bibles(version:Version):Promise<boolean>{
    // Tell the user a version can't be rebuilt because fetch.bible has withdrawn a translation it
    // renders (see version_missing_bibles), rather than let the attempt fail through to the server
    // and end on a "contact us" screen there's nothing to contact anyone about. The version itself
    // is left as it was
    const missing = version_missing_bibles(version)
    if (!missing.length){
        return false
    }
    await alert_dialog(translate('display.version.bible_withdrawn', {bibles: missing.join(', ')}))
    return true
}


export async function regenerate_version(version:Version):Promise<void>{
    // Recompile an expired/failed version's PDF from its frozen blueprint and font snapshot
    // NOTE Storage rules only allow (re)creating the object when it no longer exists
    if (version.status === 'pending' || await refuse_missing_bibles(version)){
        return
    }
    const fonts = await load_version_fonts(version)
    const job = recompile_job(version, fonts)
    // A new attempt, timed from its own start rather than the original build's click
    delete build_requests[version.id]
    await updateDoc(doc(firestore, 'versions', version.id), {status: 'pending', error: null})
    await update_latest_summary(version.design_id, version.save_token,
        {'latest_version.status': 'pending'})
    await compile_and_upload(job)
}


export async function regenerate_cover(version:Version):Promise<void>{
    // Re-render just the cover for a version whose interior succeeded but whose cover failed.
    // Far cheaper than regenerate_version (no interior recompile) and it sidesteps the
    // create-once doc.pdf a full recompile would 403 on — only the absent cover.pdf is produced.
    // Tried in this browser first, then handed to the server like a fresh build's cover
    if (!version.blueprint.cover || version.status !== 'available'){
        return
    }
    // The cover's copyright blurb is generated from each translation's licence metadata
    if (await refuse_missing_bibles(version)){
        return
    }
    const doc_ref = doc(firestore, 'versions', version.id)
    // Rendered in this tab until handed over, so warn before leaving until then, and once any
    // build compiling here has finished (see claim_compile_turn)
    const release_page = hold_page()
    const release_turn = await claim_compile_turn()
    try {
        const cover = await render_cover_here(version.id, version.blueprint,
            version.pages ?? 0, () => load_version_fonts(version), 'cover_regen')
        await updateDoc(doc_ref, cover_status_fields(cover))
        if (cover === 'available'){
            return
        }
    } catch (error){
        // The failed cover status is what tells the user (with its own retry)
        report_error('silent', error,
            {critical: true, context: {version_id: version.id, stage: 'cover_regen'}})
        await updateDoc(doc_ref, {cover_status: 'failed'}).catch(() => undefined)
        return
    } finally {
        release_turn()
        release_page()
    }
    await finish_cover_on_server(version.id)
}


async function adopt_pending_pdf(version:Version):Promise<boolean>{
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
    // A cover failure here doesn't hold up the interior, same as the main compile path: adopt
    // the interior and hand the cover to the server
    let cover:'available'|'pending'|null = null
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
        cover = 'available'
        if (cover_missing){
            cover = await render_cover_here(version.id, version.blueprint, pages,
                () => load_version_fonts(version), 'cover_render')
        }
    }

    await updateDoc(doc(firestore, 'versions', version.id), {
        status: 'available',
        ...cover ? cover_status_fields(cover) : {cover_status: null},
        pages,
        pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
        error: null,
    })
    await update_latest_summary(version.design_id, version.save_token,
        {'latest_version.status': 'available', 'latest_version.pages': pages})
    if (cover === 'pending'){
        await finish_cover_on_server(version.id)
    }
    return true
}


export async function retry_version(version:Version):Promise<void>{
    // Hand a version that's been stuck in 'pending' past STUCK_MS to the server compile (see
    // version_stuck). Unlike regenerate_version this deliberately accepts a pending version —
    // it's the recovery path for one whose original compile never finished (tab reload/close/
    // crash, killed server instance). Never one this tab is still compiling.
    // Always the server, never this browser: the likeliest reason a compile's driver vanished is
    // the browser itself running out of memory, which on iOS kills and reloads the page with no
    // error to catch, so retrying here would just crash the same way again
    if (version.status !== 'pending' || version.id in version_progress){
        return
    }
    // The PDF may already be sitting in Storage (upload landed but the status write didn't) —
    // adopt it instead of recompiling (which may render + upload a missing cover in this tab, so
    // leaving is warned about meanwhile, and waits for any build compiling here to finish first)
    const release_page = hold_page()
    const release_turn = await claim_compile_turn()
    try {
        if (await adopt_pending_pdf(version)){
            return
        }
    } finally {
        release_turn()
        release_page()
    }
    if (await refuse_missing_bibles(version)){
        return
    }
    // A new attempt, timed from its own start rather than the original build's click, so it
    // isn't read as stuck again while the server's job waits to start
    delete build_requests[version.id]
    const doc_ref = doc(firestore, 'versions', version.id)
    await updateDoc(doc_ref, {error: null, compile_started: serverTimestamp()})
    try {
        await request_server_compile(version.id, recompile_page_estimate(version))
    } catch (error){
        await record_server_unreachable(doc_ref, version.design_id, version.save_token, error)
    }
}


// Versions resume_abandoned_versions has already looked at during this page load, so each is
// handed over at most once however often its design is reopened
const resume_considered = new Set<string>()


export function resume_abandoned_versions(loaded:Version[]):void{
    // Hand the server any of the user's versions that were pending without a server compile when
    // their design was opened (`loaded` is the versions list's first snapshot). Their browser
    // compile has most likely died: iOS kills and reloads a page that runs out of memory with no
    // error to catch, and reloading or closing the tab mid-compile ends it too. The doc can't
    // tell a dead compile from one still running in another tab or device, so that case gets
    // compiled on the server as well — harmless, as whichever finishes second either overwrites
    // the same PDF (server) or has its upload refused (browser, see version_settled)
    for (const version of loaded){
        if (resume_considered.has(version.id)){
            continue
        }
        resume_considered.add(version.id)
        // Only the user's own (the server compiles for the owner alone), never one this tab is
        // building or built, and never one the server already took over. A withdrawn translation
        // is left for the version's own retry to explain
        if (version.status !== 'pending' || !version_retryable(version)
                || version.id in version_progress || version.id in build_requests
                || compiling_on_server(version) || version_missing_bibles(version).length){
            continue
        }
        void resume_on_server(version)
    }
}


async function resume_on_server(version:Version):Promise<void>{
    // Ask the server once to compile an abandoned version (see resume_abandoned_versions). Any
    // refusal leaves the version as it was, where it's offered a retry at STUCK_MS as before
    try {
        // A new attempt, so it isn't read as stuck while the server's job waits to start
        await updateDoc(doc(firestore, 'versions', version.id),
            {compile_started: serverTimestamp()})
        await api('/api/compile',
            {version_id: version.id, page_count: recompile_page_estimate(version)})
    } catch (error){
        // Already published, or already compiling on the server, means nothing was abandoned
        const expected = error instanceof ApiError
            && (error.code === 'not_pending' || error.code === 'compile_in_progress')
        if (!expected){
            report_error('silent', error,
                {context: {version_id: version.id, stage: 'compile_resume'}})
        }
    }
}
