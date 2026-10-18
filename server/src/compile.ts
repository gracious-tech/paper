
import path from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'

import {Timestamp} from 'firebase-admin/firestore'
import {LambdaClient, InvokeCommand} from '@aws-sdk/client-lambda'
import {PDFDocument} from 'pdf-lib'
import {PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS,
    cover_form_for_render, is_builtin_background, is_known_builtin_background,
    is_fetchable_image_url, doc_has_copyright,
    replace_copyright_marker, gen_copyright_typst, version_assets_prefix,
    migrate_version_blueprint} from 'paper-bible-typst'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'
import {generate as generate_cover, build_schema} from 'bookcover-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {quota_allows, claim_compile_lock, extend_compile_lock, release_compile_lock,
    QUOTA_COMPILE, DAILY_COMPILE_LIMIT} from './quota.ts'
import {collect_image_urls} from './assets.ts'
import {shared_content} from './content.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {DocumentData, DocumentReference} from 'firebase-admin/firestore'
import type {EmbedFormState} from 'bookcover-node'
import type {PmDoc} from 'paper-bible-typst'
import type {Blueprint, CustomFont} from 'paper-bible-typst-node'
import type {HandlerResult} from './types.ts'


// A server compile, as the light function's /api/compile route hands it to the compile function
// (see dispatch_compile). Plain JSON, since in production it crosses as an async Lambda
// invocation's payload. Only the light function may invoke the compile function (IAM), so the
// uid here was verified from the caller's ID token
export interface CompileJob {
    uid:string
    version_id:string
    client_ip:string|null
    user_agent:string|null
    // Advisory page-count estimate for the auto binding-gutter (see margin_gutter_auto)
    page_count?:number
}


// A version that passed check_version(), with what the compile goes on to need from it
interface CheckedVersion {
    doc_ref:DocumentReference
    data:DocumentData
    design_id:string
    blueprint:Blueprint
    fonts_meta:{family:string, style:'serif'|'sans', files:string[]}[]
}


// Invokes the compile function from the light one (created on first dispatch)
let lambda_client:LambdaClient|null = null


async function render_cover(blueprint:Blueprint, custom_fonts:CustomFont[], page_count:number,
        share_url?:string)
        :Promise<Uint8Array>{
    // Render a frozen blueprint's cover to PDF bytes via the bookcover-node package (Typst
    // CLI + the same mounted fonts tree the book compile uses). The renderable schema is
    // derived from the stored widget form with the blueprint's own size fields (and the
    // just-compiled interior's page count, which drives the spine width) overlaid —
    // identical logic to the in-browser path (see cover.ts / cover_worker.ts in the app)
    const cover = blueprint.cover!
    const cover_fonts = custom_fonts.filter(font => cover.font_families.includes(font.family))
    const schema = build_schema(
        cover_form_for_render(cover, blueprint, page_count) as unknown as EmbedFormState,
        cover_fonts.map(font => ({family: font.family, style: font.style})))

    // Resolve the AUTO-COPYRIGHT marker the blurb may carry (the default cover seeds it into
    // its rear text) into the design's full attribution statement — mirrors the interior
    // compile and the in-browser cover path (see cover.ts / cover_worker.ts in the app)
    const blurb = schema['blurb']
    if (doc_has_copyright(cover.form['blurb'] as PmDoc | undefined) && typeof blurb === 'string'){
        await shared_content.init()
        const resources = shared_content.collection.get_resources({object: true})
        schema['blurb'] = replace_copyright_marker(
            blurb, gen_copyright_typst(blueprint, resources, share_url))
    }

    // bookcover-node works on disk: it discovers a background image in the input dir (or, for
    // a builtin, an explicit filename set via schema.images.background — a side channel
    // bookcover-node reads even though CoverSchema's own type has no `images` field) and
    // writes the output file (the temp dir is always cleaned up, even on failure)
    const tmp_dir = await mkdtemp(path.join(tmpdir(), 'cover_'))
    try {
        let images:{background:string}|undefined
        let image_builtin:string|undefined
        if (cover.bg_image?.kind === 'custom'){
            const ext = cover.bg_image.path.slice(cover.bg_image.path.lastIndexOf('.'))
            const [bg_bytes] = await admin_bucket.file(cover.bg_image.path).download()
            await writeFile(path.join(tmp_dir, `background${ext}`), bg_bytes)
        } else if (cover.bg_image?.kind === 'builtin'){
            // The id is client-controlled and about to become a filesystem path against the
            // assets dir, so it must name a background bookcover actually ships (which also
            // keeps out backgrounds/'s previews_*/thumbnails/originals subdirectories).
            // handle_compile() only shape-checks it, so a row naming a background bookcover has
            // since retired fails here, which fails only the cover render — the interior is
            // already compiled and published by then
            const id = cover.bg_image.id
            if (!is_known_builtin_background(id)){
                throw new Error(`Unknown builtin cover background: ${id}`)
            }
            const bg_bytes = await readFile(path.join(config.assets_dir, 'backgrounds', id))
            // Written under its real filename (not a generic one) — load-bearing: this is
            // exactly the name that must match schema.images.background below, and
            // bookcover-node's file lookup has no fallback discovery when an explicit name
            // is given
            await writeFile(path.join(tmp_dir, id), bg_bytes)
            images = {background: id}
            // Named by id so the auto colours come from bookcover's baked table — the same ones
            // the browser's preview and version renders use
            image_builtin = id
        }
        const output_path = path.join(tmp_dir, 'cover.pdf')
        await generate_cover({
            schema: {...schema, ...images && {images}},
            ...image_builtin !== undefined && {image_builtin},
            input_path: tmp_dir,
            output_path,
            format: 'pdf',
            assets_dir: config.assets_dir,
            fonts_dir: config.fonts_dir,
            typst_path: config.typst_path,
            custom_fonts: cover_fonts,
        })
        return new Uint8Array(await readFile(output_path))
    } finally {
        await rm(tmp_dir, {recursive: true, force: true})
    }
}


async function record_compile_stat(fields:{version_id:string, design_id:string, owner:string,
        engine:'server', interior_ms:number, pages:number|null, ok:boolean,
        user_agent:string|null, estimated_pages:number|null, gutter_auto:boolean}):Promise<void>{
    // Log a server-side interior compile to the write-only compile_stats collection for offline
    // performance analysis (never shown to the user). Best-effort — a lost stat row must never
    // affect the compile result. The browser records its own rows for the in-browser path.
    // estimated_pages is the client's page-count guess that fed the auto binding-gutter (see
    // margin_gutter_auto); paired with the actual `pages` it shows offline how far the estimate
    // strays, and gutter_auto flags the rows where that gap would actually change the layout
    try {
        await admin_db.collection('compile_stats').add({
            ...fields,
            created: Timestamp.now(),
            // Firestore's TTL policy on this field drops the row after ~1 year (see
            // .bin/deploy_firebase_initial); analysis only ever wants the recent window
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
        })
    } catch (error){
        console.error(error)
    }
}


async function check_version(uid:string, version_id:string)
        :Promise<{ok:true, version:CheckedVersion}|{ok:false, refusal:HandlerResult}>{
    // Validate a version for a server compile and the caller's right to it. Run twice: by the
    // route before it accepts the job, so a refusal reaches the client, and again by the compile
    // itself, since the job carries only ids and the doc is the one thing it can trust
    // A refusal, in the shape the route responds with
    const refuse = (status:number, error:string) => {
        return {ok: false as const, refusal: {status, body: {error}}}
    }

    const doc_ref = admin_db.doc(`versions/${version_id}`)
    const snap = await doc_ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return refuse(404, 'unknown_version')
    }
    if (data['owner'] !== uid){
        return refuse(403, 'not_owner')
    }
    if (data['status'] !== 'pending'){
        return refuse(409, 'not_pending')
    }

    // Snapshots live under the parent *design*, shared by all its versions — design_id is
    // pinned at create by the rules and immutable thereafter, so it can only name a design the
    // writer could already edit
    const design_id = data['design_id'] as string
    const assets_prefix = version_assets_prefix(design_id)
    const fonts_meta = (data['custom_fonts'] ?? []) as
        {family:string, style:'serif'|'sans', files:string[]}[]
    if (fonts_meta.some(meta => meta.files.some(path => !path.startsWith(assets_prefix)))){
        return refuse(400, 'bad_font_path')
    }

    // The cover's bg image reference lives inside the client-written blueprint, so it gets
    // the same distrust as font paths (including its type, since nothing validates the doc's
    // shape server-side): a 'custom' snapshot must sit under the design's version prefix, a
    // 'builtin' id must at least be a plain image filename. Only the shape is checked here —
    // failing it 400s the whole compile, interior included, so whether bookcover still ships
    // that background is left to render_cover() above, where it can only cost the cover
    // Brought up to the current schema for this render only — migrate_version_blueprint() always
    // clones, so the version's stored blueprint stays exactly as it was published (see
    // migrate.ts). Everything below, validation included, works on the migrated shape
    const blueprint = migrate_version_blueprint(data)
    const bg_image = (blueprint.cover?.bg_image ?? null) as unknown
    if (bg_image !== null){
        if (typeof bg_image !== 'object'){
            return refuse(400, 'bad_cover_image')
        }
        const rec = bg_image as Record<string, unknown>
        if (rec['kind'] === 'custom'){
            const p = rec['path']
            if (typeof p !== 'string' || !p.startsWith(assets_prefix)){
                return refuse(400, 'bad_cover_path')
            }
        } else if (rec['kind'] === 'builtin'){
            const id = rec['id']
            if (typeof id !== 'string' || !is_builtin_background(id)){
                return refuse(400, 'bad_cover_image')
            }
        } else {
            return refuse(400, 'bad_cover_image')
        }
    }

    // Passage images are fetched by url at render time (see image_cache.ts), and the content
    // list is client-written like everything else on the doc — so every url gets checked here
    // before the compile runs. Without this the compile service would fetch whatever address a
    // crafted version doc named, including ones on its own network. The browser path needs no
    // equivalent: there the fetch happens under the page's own origin policy
    for (const url of collect_image_urls(blueprint)){
        if (!is_fetchable_image_url(url, config.dev)){
            return refuse(400, 'bad_image_url')
        }
    }

    return {ok: true, version: {doc_ref, data, design_id, blueprint, fonts_meta}}
}


async function dispatch_compile(job:CompileJob):Promise<void>{
    // Start an accepted compile without waiting for it. In production that's an async ('Event')
    // invocation of the compile function, which Lambda queues and runs to the function's own
    // timeout with no HTTP request attached. Running from source there's no function to invoke,
    // so the compile runs in this process instead — only where this process serves the compile
    // role too (dev's default): a light-only Lambda is frozen the moment its response goes out
    if (config.compile_function !== null){
        lambda_client ??= new LambdaClient({})
        await lambda_client.send(new InvokeCommand({
            FunctionName: config.compile_function,
            InvocationType: 'Event',
            Payload: new TextEncoder().encode(JSON.stringify(job)),
        }))
        return
    }
    if (!config.roles.includes('compile')){
        throw new Error('No compile function to dispatch to (COMPILE_FUNCTION is unset)')
    }
    // The compile records its own outcome on the version doc; this only keeps anything it
    // couldn't record from going unhandled and taking the dev server down with it
    void run_compile(job).catch(error => console.error(error))
}


export async function handle_compile(job:CompileJob):Promise<HandlerResult>{
    // Accept a pending version for a server compile (fallback for devices whose in-browser
    // compile failed, and regeneration of expired PDFs): run every check that can refuse it, then
    // hand it to the compile function and answer 202 straight away. A compile can outlast any
    // request API Gateway will hold open (30s), so its outcome is only ever recorded on the
    // version doc, which the client already syncs
    const {uid, version_id} = job
    const checked = await check_version(uid, version_id)
    if (!checked.ok){
        return checked.refusal
    }

    // One server compile at a time per user (heavy CPU/memory work; anonymous users can trigger
    // this). A live compile of this same version (another tab, a retry racing the original) is
    // as good as this request succeeding — its outcome reaches the client the same way
    const claim = await claim_compile_lock(uid, version_id)
    if (claim === 'same_version'){
        return {status: 409, body: {error: 'not_pending'}}
    }
    if (claim === 'other_version'){
        return {status: 429, body: {error: 'compile_in_progress'}}
    }
    if (!await quota_allows(QUOTA_COMPILE, uid, DAILY_COMPILE_LIMIT)){
        await release_compile_lock(uid, version_id)
        return {status: 429, body: {error: 'quota_exceeded'}}
    }

    // Stamp the attempt start, so a job that never runs (dropped from Lambda's queue) reads as
    // stuck on the client rather than forever-pending — see version_stuck() in the app
    await checked.version.doc_ref.update({compile_started: Timestamp.now()})
        .catch(() => undefined)

    try {
        await dispatch_compile(job)
    } catch (error){
        console.error(error)
        await release_compile_lock(uid, version_id)
        return {status: 500, body: {error: 'dispatch_failed'}}
    }
    return {status: 202, body: {ok: true}}
}


export async function run_compile(job:CompileJob, prepare?:() => Promise<void>):Promise<void>{
    // Compile a version the light function accepted (see handle_compile) and record the outcome
    // on its doc — nothing waits on this but the client's sync of that doc. `prepare` is the
    // compile function's cold-start asset sync (see lambda.ts), run inside the failure handling
    // below so a sync that fails marks the version failed rather than leaving it pending
    const {uid, version_id} = job
    try {
        // A concurrent compile may have finished the version while this job was queued
        const checked = await check_version(uid, version_id)
        if (!checked.ok){
            console.warn(`Compile of ${version_id} skipped:`, checked.refusal.body)
            return
        }
        // Best-effort: failing it only risks the lock lapsing mid-compile, which beats leaving a
        // compile that's ready to run with nothing to record its outcome
        await extend_compile_lock(uid, version_id).catch(error => console.error(error))
        await compile_version(job, checked.version, prepare)
    } finally {
        // Best-effort: a lock left behind lapses on its own (see COMPILE_LOCK_MS)
        await release_compile_lock(uid, version_id).catch(error => console.error(error))
    }
}


async function compile_version(job:CompileJob, version:CheckedVersion,
        prepare?:() => Promise<void>):Promise<void>{
    // The compile itself: render the interior (and cover) to PDF, publish them to Storage, and
    // mark the version available — or, on any failure, failed with an error report's id
    const {uid, version_id, client_ip, user_agent, page_count} = job
    const {doc_ref, data, design_id, blueprint, fonts_meta} = version

    // Whether this version is still its design's actual latest one — regenerating an older
    // version must never clobber the design's denormalized `latest_version` summary (used by the
    // /designs list) with a stale status/pages. A newer version created since would have
    // overwritten the design's latest_version.save_token with its own, so comparing this
    // version's own save_token against it tells them apart
    const design_ref = admin_db.doc(`designs/${design_id}`)
    const design_data = (await design_ref.get()).data()
    const is_latest = (design_data?.['latest_version'] as {save_token?:string}|undefined)
        ?.save_token === data['save_token']

    // Production URL for this exact version — woven into the attribution block (link + QR code)
    // when the blueprint opts in (see gen_copyright_typst). Short /v/:id form (just the version
    // id) rather than /designs/:design_id/:version so the printed link/QR stays short
    const share_url = `${config.app_url}/v/${version_id}`

    // Storage paths are always derived from the version id, never read from the doc — doc
    // fields are client-written, and trusting them would let a crafted doc make the Admin SDK
    // read/overwrite arbitrary bucket objects
    const pdf_path = `versions/${version_id}/doc.pdf`

    // Wall-clock of the interior compile, for the compile_stats telemetry (set right before the
    // compile so the failure path only logs a real attempt)
    let interior_start:number|null = null

    try {
        // Re-stamp the attempt start so a compile killed here (timeout, OOM on the largest docs)
        // reads as stuck rather than forever-pending on the client — see version_stuck() in the
        // app. Restarts the count the route began, which may have been spent in Lambda's queue
        await doc_ref.update({compile_started: Timestamp.now()}).catch(() => undefined)

        // Make sure the fonts/backgrounds the compile reads are in place
        await prepare?.()

        // Download the version's snapshotted custom fonts (usually none)
        const custom_fonts:CustomFont[] = await Promise.all(
            fonts_meta.map(
                async meta => ({
                    family: meta.family,
                    style: meta.style,
                    files: await Promise.all(meta.files.map(async path => {
                        return new Uint8Array((await admin_bucket.file(path).download())[0])
                    })),
                })))

        // Compile straight from the frozen blueprint (Bible content comes via the instance-wide
        // shared cache — see content.ts)
        interior_start = performance.now()
        const bytes = await compile_pdf_from_blueprint(blueprint, {
            typst_path: config.typst_path,
            fonts_dir: config.fonts_dir,
            content: shared_content,
            custom_fonts,
            share_url,
            page_count,
            // The version's frozen display name, for the PDF's metadata title
            doc_name: data['title'] as string|undefined,
        })
        const interior_ms = performance.now() - interior_start
        const pages = (await PDFDocument.load(bytes)).getPageCount()

        // Record the successful server-side compile for offline performance analysis
        void record_compile_stat({version_id, design_id, owner: uid, engine: 'server',
            interior_ms, pages, ok: true, user_agent, estimated_pages: page_count ?? null,
            gutter_auto: !!blueprint.margin_gutter_auto})

        // Publish the PDF and mark the version available (contentDisposition: 'inline' so the
        // iframe preview displays it rather than triggering a download — the Storage emulator
        // defaults to 'attachment' when it's left unset, unlike production)
        await admin_bucket.file(pdf_path).save(Buffer.from(bytes), {
            contentType: 'application/pdf',
            metadata: {contentDisposition: 'inline'},
        })

        // Render + publish the cover as its own separate PDF when the version has one (a
        // wraparound cover is a different page size and print services take it as its own
        // file). Rendered after the interior deliberately — its spine width derives from the
        // actual page count just compiled. A cover failure is non-fatal (mirrors the in-browser
        // path in versions.ts): the interior is already compiled and uploaded, so record
        // cover_status 'failed' and still publish the version
        let cover_status:'available'|'failed'|null = null
        if (blueprint.cover){
            try {
                const cover_bytes = await render_cover(blueprint, custom_fonts, pages, share_url)
                await admin_bucket.file(`versions/${version_id}/cover.pdf`).save(
                    Buffer.from(cover_bytes),
                    {contentType: 'application/pdf', metadata: {contentDisposition: 'inline'}})
                cover_status = 'available'
            } catch (cover_error){
                console.error(cover_error)
                cover_status = 'failed'
                await save_error({
                    id: generate_error_id(),
                    source: 'server',
                    severity: 'silent',
                    message: cover_error instanceof Error
                        ? cover_error.stack ?? cover_error.message : String(cover_error),
                    ip: client_ip,
                    uid,
                    url: '/api/compile',
                    user_agent: null,
                    language: null,
                    runtime_ms: null,
                    context: {version_id, stage: 'cover_render'},
                }).catch(() => undefined)
            }
        }

        await doc_ref.update({
            status: 'available',
            cover_status,
            pages,
            pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
            error: null,
        })
        if (is_latest){
            await design_ref.update(
                {'latest_version.status': 'available', 'latest_version.pages': pages})
        }

    } catch (error){
        console.error(error)
        const message = error instanceof Error ? error.message : String(error)

        // Log the failed server-side attempt (only if the compile itself was reached) alongside
        // how long it ran before failing
        if (interior_start !== null){
            void record_compile_stat({version_id, design_id, owner: uid, engine: 'server',
                interior_ms: performance.now() - interior_start, pages: null, ok: false,
                user_agent, estimated_pages: page_count ?? null,
                gutter_auto: !!blueprint.margin_gutter_auto})
        }

        // Save a report (a document failing to render is critical) and put its id on the doc
        // so the app can offer the user a support link containing it
        const error_id = await save_error({
            id: generate_error_id(),
            source: 'server',
            severity: 'critical',
            message: error instanceof Error ? error.stack ?? error.message : String(error),
            ip: client_ip,
            uid,
            url: '/api/compile',
            user_agent: null,
            language: null,
            runtime_ms: null,
            context: {version_id},
        })
        await doc_ref.update({status: 'failed', error: message, error_id})
            .catch(() => undefined)
        if (is_latest){
            await design_ref.update({'latest_version.status': 'failed'}).catch(() => undefined)
        }
    }
}
