
import path from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'

import {Timestamp} from 'firebase-admin/firestore'
import {PDFDocument} from 'pdf-lib'
import {PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS, cover_form_for_render,
    KNOWN_BUILTIN_BACKGROUNDS, doc_has_copyright, replace_copyright_marker,
    gen_copyright_typst} from 'paper-bible-typst'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'
import {generate as generate_cover, build_schema} from 'bookcover-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {shared_content} from './content.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {EmbedFormState} from 'bookcover-node'
import type {PmDoc} from 'paper-bible-typst'
import type {Blueprint, CustomFont} from 'paper-bible-typst-node'


// One compile at a time per user (heavy CPU/memory work; anonymous users can trigger this)
const active_uids = new Set<string>()


// Per-uid daily compile cap — deters cost abuse via minted anonymous accounts. Tracked in
// Firestore (compile_quota/{uid}) so it holds across instances, unlike the Set above; the
// path matches no security rule, so clients can't read or reset it
const DAILY_COMPILE_LIMIT = 50


async function compile_quota_allows(uid:string):Promise<boolean>{
    // Count an attempted compile against the caller's daily quota, refusing once over it
    const day = new Date().toISOString().slice(0, 10)
    return await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`compile_quota/${uid}`)
        const data = (await txn.get(doc_ref)).data()
        const count = (data?.['day'] === day ? data['count'] as number : 0) + 1
        if (count > DAILY_COMPILE_LIMIT){
            return false
        }
        txn.set(doc_ref, {day, count})
        return true
    })
}


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
        if (cover.bg_image?.kind === 'custom'){
            const ext = cover.bg_image.path.slice(cover.bg_image.path.lastIndexOf('.'))
            const [bg_bytes] = await admin_bucket.file(cover.bg_image.path).download()
            await writeFile(path.join(tmp_dir, `background${ext}`), bg_bytes)
        } else if (cover.bg_image?.kind === 'builtin'){
            // id is already validated against KNOWN_BUILTIN_BACKGROUNDS in handle_compile()
            // before this ever runs — required, since it's client-controlled and used to build
            // a filesystem path against the assets mount
            const id = cover.bg_image.id
            const bg_bytes = await readFile(path.join(config.assets_dir, 'backgrounds', id))
            // Written under its real filename (not a generic one) — load-bearing: this is
            // exactly the name that must match schema.images.background below, and
            // bookcover-node's file lookup has no fallback discovery when an explicit name
            // is given
            await writeFile(path.join(tmp_dir, id), bg_bytes)
            images = {background: id}
        }
        const output_path = path.join(tmp_dir, 'cover.pdf')
        await generate_cover({
            schema: {...schema, ...images && {images}},
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
            // .bin/setup_firebase); analysis only ever wants the recent window
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
        })
    } catch (error){
        console.error(error)
    }
}


export async function handle_compile(uid:string, version_id:string, client_ip:string|null,
        user_agent:string|null, page_count?:number)
        :Promise<{status:number, body:Record<string, unknown>}>{
    // Compile a pending version's PDF server-side (fallback for devices whose in-browser
    // compile failed, and regeneration of expired PDFs)

    // Validate the version and the caller's right to it
    const doc_ref = admin_db.doc(`versions/${version_id}`)
    const snap = await doc_ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 404, body: {error: 'unknown_version'}}
    }
    if (data['owner'] !== uid){
        return {status: 403, body: {error: 'not_owner'}}
    }
    if (data['status'] !== 'pending'){
        return {status: 409, body: {error: 'not_pending'}}
    }

    // Whether this version is still its design's actual latest one — regenerating an older
    // version must never clobber the design's denormalized `latest_version` summary (used by the
    // /designs list) with a stale status/pages. A newer version created since would have
    // overwritten the design's latest_version.save_token with its own, so comparing this
    // version's own save_token against it tells them apart
    const design_id = data['design_id'] as string
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
    const fonts_prefix = `versions/${version_id}/fonts/`
    const fonts_meta = (data['custom_fonts'] ?? []) as
        {family:string, style:'serif'|'sans', files:string[]}[]
    if (fonts_meta.some(meta => meta.files.some(path => !path.startsWith(fonts_prefix)))){
        return {status: 400, body: {error: 'bad_font_path'}}
    }

    // The cover's bg image reference lives inside the client-written blueprint, so it gets
    // the same distrust as font paths (including its type, since nothing validates the doc's
    // shape server-side): a 'custom' snapshot must sit under the version's own prefix, a
    // 'builtin' id must be one of the known assets-bucket filenames — required since it's
    // used to build a filesystem path against the assets mount (render_cover() above)
    const blueprint = data['blueprint'] as Blueprint
    const bg_image = (blueprint.cover?.bg_image ?? null) as unknown
    if (bg_image !== null){
        if (typeof bg_image !== 'object'){
            return {status: 400, body: {error: 'bad_cover_image'}}
        }
        const rec = bg_image as Record<string, unknown>
        if (rec['kind'] === 'custom'){
            const p = rec['path']
            if (typeof p !== 'string' || !p.startsWith(`versions/${version_id}/cover/`)){
                return {status: 400, body: {error: 'bad_cover_path'}}
            }
        } else if (rec['kind'] === 'builtin'){
            const id = rec['id']
            if (typeof id !== 'string' || !KNOWN_BUILTIN_BACKGROUNDS.has(id)){
                return {status: 400, body: {error: 'bad_cover_image'}}
            }
        } else {
            return {status: 400, body: {error: 'bad_cover_image'}}
        }
    }

    // Throttle
    if (active_uids.has(uid)){
        return {status: 429, body: {error: 'compile_in_progress'}}
    }
    if (!await compile_quota_allows(uid)){
        return {status: 429, body: {error: 'quota_exceeded'}}
    }
    active_uids.add(uid)

    // Wall-clock of the interior compile, for the compile_stats telemetry (set right before the
    // compile so the failure path only logs a real attempt)
    let interior_start:number|null = null

    try {
        // Re-stamp the attempt start so a compile killed here (instance termination, OOM on the
        // largest docs, request timeout) reads as stuck rather than forever-pending on the
        // client — see version_stuck() in the app
        await doc_ref.update({compile_started: Timestamp.now()}).catch(() => undefined)

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
        return {status: 200, body: {ok: true, pages}}

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
        return {status: 500, body: {error: 'compile_failed'}}

    } finally {
        active_uids.delete(uid)
    }
}
