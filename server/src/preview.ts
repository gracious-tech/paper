
// Previews made on the server, for devices that can't compile in their browser (see
// compile_mode.ts in the app): a window of the design's pages, each a standalone SVG, plus the
// cover when the window starts at the book's start — exactly what the browser makes, which the
// app lays out as a phone's column or a desktop's facing-page spreads.
//
// Like a server compile, a preview outlasts anything API Gateway will hold a request open for,
// so /api/preview only checks and accepts it (handle_preview), the compile function makes it
// (run_preview), and the outcome reaches the client through a `previews/{id}` doc it listens to.
// The output goes to the design's cache prefix, public by its unguessable path like the rest of
// it, and swept with it.

import {gzipSync} from 'node:zlib'

import {Timestamp, FieldValue} from 'firebase-admin/firestore'
import {design_assets_prefix, design_cache_prefix, truncate_for_preview, PREVIEW_LIMITS,
    svg_page_markup, cover_page_geometry, crop_cover_svg, COMPILE_STATS_LIFETIME_MS}
    from 'paper-bible-typst'
import {compile_svg_preview, load_fonts_dir} from 'paper-bible-typst-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {quota_allows, QUOTA_PREVIEW, DAILY_PREVIEW_LIMIT} from './quota.ts'
import {check_assets, download_fonts, render_cover_svgs} from './compile.ts'
import {storage_public_url, join_design_blueprint} from './assets.ts'
import {shared_content} from './content.ts'
import {dispatch_job} from './dispatch.ts'
import {new_id} from './designs.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {Blueprint} from 'paper-bible-typst-node'
import type {PreviewPages, PreviewSection, PreviewSize, StoredFontMeta} from 'paper-bible-typst'
import type {HandlerResult} from './types.ts'


// How long a preview's doc is kept (Firestore TTL on `expires`, see deploy_firebase_initial):
// a preview is looked at once, straight after it's made
export const PREVIEW_DOC_LIFETIME_MS = 24 * 60 * 60 * 1000


// A preview, as /api/preview hands it to the compile function (see dispatch_job). The `kind`
// tells it apart from a version compile (CompileJob) in the compile function's handler
export interface PreviewJob {
    kind:'preview'
    uid:string
    preview_id:string
    design_id:string
    client_ip:string|null
    user_agent:string|null
    // Which device it's for, which sets the window's size (see PREVIEW_LIMITS)
    size:PreviewSize
    // Which window of a long document (the desktop's Start/Middle/End; a phone's is the start)
    section:PreviewSection
    // Advisory page-count estimate for the auto binding-gutter (see margin_gutter_auto)
    page_count?:number
}


// A design that passed check_design(), with what the preview goes on to need from it
interface CheckedDesign {
    blueprint:Blueprint
    fonts_meta:StoredFontMeta[]
}


export function parse_preview_body(body:Record<string, unknown>)
        :Pick<PreviewJob, 'size'|'section'|'page_count'>|null{
    // The preview's options from a request body, or null if they're malformed. A phone's window
    // is always the start of the document
    const size = body['size']
    const section = body['section'] ?? 'start'
    if ((size !== 'phone' && size !== 'desktop')
            || (section !== 'start' && section !== 'middle' && section !== 'end')){
        return null
    }
    const page_count = typeof body['page_count'] === 'number' && body['page_count'] > 0
        ? body['page_count'] : undefined
    return {size, section: size === 'phone' ? 'start' : section,
        ...page_count !== undefined && {page_count}}
}


async function check_design(uid:string, design_id:string)
        :Promise<{ok:true, design:CheckedDesign}|{ok:false, refusal:HandlerResult}>{
    // Validate a design for a preview and the caller's right to it. Run by the route before it
    // accepts the job, and again by the preview itself, which reads the design as it is by then
    const refuse = (status:number, error:string) => {
        return {ok: false as const, refusal: {status, body: {error}}}
    }
    const data = (await admin_db.doc(`designs/${design_id}`).get()).data()
    if (!data){
        return refuse(404, 'unknown_design')
    }
    if (!(data['editor_uids'] as string[]|undefined)?.includes(uid)){
        return refuse(403, 'not_editor')
    }
    const blueprint = join_design_blueprint(data)
    // The design's uploaded fonts, a map keyed by font id (see custom_fonts.ts in the app)
    const fonts_meta = Object.values((data['fonts'] ?? {}) as Record<string, StoredFontMeta>)
    const bad_asset = check_assets(blueprint, fonts_meta, design_assets_prefix(design_id))
    if (bad_asset){
        return refuse(400, bad_asset)
    }
    return {ok: true, design: {blueprint, fonts_meta}}
}


export async function handle_preview(job:Omit<PreviewJob, 'preview_id'>)
        :Promise<HandlerResult>{
    // Accept a preview of a design the caller can edit: check it, count it against the daily
    // quota, create the doc its outcome will be recorded on, and hand it to the compile function
    const checked = await check_design(job.uid, job.design_id)
    if (!checked.ok){
        return checked.refusal
    }
    if (!await quota_allows(QUOTA_PREVIEW, job.uid, DAILY_PREVIEW_LIMIT)){
        return {status: 429, body: {error: 'quota_exceeded'}}
    }

    const preview_id = new_id()
    const doc_ref = admin_db.doc(`previews/${preview_id}`)
    await doc_ref.set({
        owner: job.uid,
        design_id: job.design_id,
        size: job.size,
        status: 'pending',
        created: FieldValue.serverTimestamp(),
        expires: Timestamp.fromMillis(Date.now() + PREVIEW_DOC_LIFETIME_MS),
        path: null,
        pages: null,
        page_estimate: null,
        truncated: null,
        dropped_before: null,
        dropped_after: null,
        error_id: null,
    })
    const full_job:PreviewJob = {...job, preview_id}
    try {
        await dispatch_job(full_job, async () => await run_preview(full_job))
    } catch (error){
        console.error(error)
        await doc_ref.update({status: 'failed'}).catch(() => undefined)
        return {status: 500, body: {error: 'dispatch_failed'}}
    }
    return {status: 202, body: {ok: true, preview_id}}
}


export async function run_preview(job:PreviewJob, prepare?:() => Promise<void>):Promise<void>{
    // Make a preview the light function accepted and record the outcome on its doc. `prepare`
    // is the compile function's cold-start asset sync (see lambda.ts)
    const doc_ref = admin_db.doc(`previews/${job.preview_id}`)
    let compile_start:number|null = null
    try {
        // The design may have changed (or the caller lost access) while the job was queued
        const checked = await check_design(job.uid, job.design_id)
        if (!checked.ok){
            throw new Error(`Preview refused: ${JSON.stringify(checked.refusal.body)}`)
        }
        await prepare?.()
        const custom_fonts = await download_fonts(checked.design.fonts_meta)
        const blueprint = await with_styled_images(job.design_id, checked.design.blueprint)

        // Resolved as the browser resolves it (see compile_preview in the app), with the curated
        // font manifest loaded first so script detection can match fallback styles
        await load_fonts_dir(config.fonts_dir)
        await shared_content.init()
        const share_url = `${config.app_url}/designs/${job.design_id}`
        const request = await shared_content.resolve(blueprint,
            Object.fromEntries(custom_fonts.map(font => [font.family, font.style])), undefined,
            share_url, job.page_count)
        const truncation = truncate_for_preview(request, job.section, PREVIEW_LIMITS[job.size])

        compile_start = performance.now()
        const pages = await compile_svg_preview(truncation.request,
            {typst_path: config.typst_path, fonts_dir: config.fonts_dir, custom_fonts})
        const scale = truncation.window_chars > 0
            ? truncation.total_chars / truncation.window_chars : 1
        const page_estimate = Math.max(2, Math.round(Math.max(1, pages.length) * scale / 2) * 2)

        // The cover when the window starts at the book's start, its spine sized from the
        // estimate: a phone's front and back panels, or a desktop's whole wraparound with its
        // bleed cropped off and its folds marked
        let covers:string[] = []
        if (blueprint.cover && !truncation.dropped_before){
            const svgs = await render_cover_svgs(blueprint, custom_fonts, page_estimate, share_url)
            covers = job.size === 'phone' ? [svgs.front, svgs.back] : [crop_cover_svg(
                svgs.wraparound, cover_page_geometry(blueprint, page_estimate))]
        }
        const output:PreviewPages = {pages: pages.map(page => svg_page_markup(page)), covers}
        const preview_ms = performance.now() - compile_start

        // Stored gzipped (served with Content-Encoding, which browsers undo themselves), since
        // SVG compresses well and a phone may be fetching it over a slow connection
        const path = `${design_cache_prefix(job.design_id)}preview_${job.preview_id}.json`
        await admin_bucket.file(path).save(gzipSync(JSON.stringify(output)), {
            contentType: 'application/json',
            metadata: {contentEncoding: 'gzip'},
        })
        await doc_ref.update({status: 'available', path, pages: pages.length, page_estimate,
            truncated: truncation.truncated, dropped_before: truncation.dropped_before,
            dropped_after: truncation.dropped_after})
        void record_preview_stat(job, preview_ms, pages.length, true)
    } catch (error){
        console.error(error)
        if (compile_start !== null){
            void record_preview_stat(job, performance.now() - compile_start, null, false)
        }
        const error_id = await save_error({
            id: generate_error_id(),
            source: 'server',
            severity: 'silent',
            message: error instanceof Error ? error.stack ?? error.message : String(error),
            ip: job.client_ip,
            uid: job.uid,
            url: '/api/preview',
            user_agent: null,
            language: null,
            runtime_ms: null,
            context: {design_id: job.design_id, stage: `preview_${job.size}`},
        })
        await doc_ref.update({status: 'failed', error_id}).catch(() => undefined)
    }
}


async function with_styled_images(design_id:string, blueprint:Blueprint):Promise<Blueprint>{
    // The blueprint with each painted/torn image swapped for its masked variant, where the
    // browser has made one. Masking needs a canvas, so the server can't make them itself; the
    // client makes them before asking (see resolve_content_for_style in the app), under a path
    // derived from the image's position and hash, numbered in the same order as here. An image
    // without a variant (or a hash to find one by) is shown unmasked
    const style = blueprint.image_style
    if (style !== 'painted' && style !== 'torn'){
        return blueprint
    }
    let variant = 0
    const swap = async <T extends {url?:string|null, path?:string|null, hash?:string|null}>(
            image:T):Promise<T> => {
        const index = variant++
        if (!image.hash){
            return image
        }
        const path = `${design_cache_prefix(design_id)}${style}_v${index}_${image.hash}.png`
        const [exists] = await admin_bucket.file(path).exists()
        return exists ? {...image, url: storage_public_url(path), path} : image
    }
    const content = []
    for (const item of blueprint.content){
        if (item.type === 'passage' && item.image){
            content.push({...item, image: await swap(item.image)})
        } else if (item.type === 'picture_story'){
            const slides = []
            for (const slide of item.slides){
                slides.push(slide.image ? {...slide, image: await swap(slide.image)} : slide)
            }
            content.push({...item, slides})
        } else {
            content.push(item)
        }
    }
    return {...blueprint, content}
}


async function record_preview_stat(job:PreviewJob, preview_ms:number, pages:number|null,
        ok:boolean):Promise<void>{
    // Log a server preview to the write-only compile_stats collection, best-effort like the
    // version compiles' rows (see record_compile_stat in compile.ts)
    try {
        await admin_db.collection('compile_stats').add({
            kind: 'preview', size: job.size, design_id: job.design_id, owner: job.uid,
            engine: 'server', preview_ms, pages, ok, user_agent: job.user_agent,
            created: Timestamp.now(),
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
        })
    } catch (error){
        console.error(error)
    }
}
