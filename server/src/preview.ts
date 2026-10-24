
// Previews compiled on the server, for devices that can't compile in their browser (see
// compile_mode.ts in the app): a phone's preview as standalone SVG pages, or a desktop's live
// preview as the same facing-page spread PDF its browser would have made.
//
// Like a server compile, a preview outlasts anything API Gateway will hold a request open for,
// so /api/preview only checks and accepts it (handle_preview), the compile function makes it
// (run_preview), and the outcome reaches the client through a `previews/{id}` doc it listens to.
// The output goes to the design's cache prefix, public by its unguessable path like the rest of
// it, and swept with it.

import {gzipSync} from 'node:zlib'

import {Timestamp, FieldValue} from 'firebase-admin/firestore'
import {PDFDocument} from 'pdf-lib'
import {design_assets_prefix, design_cache_prefix, truncate_for_preview,
    ESTIMATE_CHAR_LIMIT, PREVIEW_CHAR_LIMIT, svg_page_markup, gen_cover_slot_typst,
    gen_preview_strip_typst, notice_fonts, add_preview_strip, prepend_cover, cover_page_geometry,
    COMPILE_STATS_LIFETIME_MS} from 'paper-bible-typst'
import {compile_svg_preview, compile_pdf_spread_preview, compile_standalone, load_fonts_dir}
    from 'paper-bible-typst-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {quota_allows, QUOTA_PREVIEW, DAILY_PREVIEW_LIMIT} from './quota.ts'
import {check_assets, download_fonts, render_cover, render_cover_front_svg} from './compile.ts'
import {storage_public_url, join_design_blueprint} from './assets.ts'
import {shared_content} from './content.ts'
import {dispatch_job} from './dispatch.ts'
import {new_id} from './designs.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {Blueprint, CustomFont} from 'paper-bible-typst-node'
import type {PreviewSection, TextDir, TypstRequest, StoredFontMeta} from 'paper-bible-typst'
import type {HandlerResult} from './types.ts'


// How long a preview's doc is kept (Firestore TTL on `expires`, see deploy_firebase_initial):
// a preview is looked at once, straight after it's made
export const PREVIEW_DOC_LIFETIME_MS = 24 * 60 * 60 * 1000


// The UI-language notices a desktop's preview carries, translated by the client, since the
// server has no UI catalogs (see DisplayPreview.vue for where each one goes)
export interface PreviewLabels {
    inside_cover:string
    banner_title:string
    banner_subtitle:string
    start_of_preview:string
    end_of_preview:string
    build_for_rest:string
}

// The longest a label may be, so a request can't make the server typeset an essay
const MAX_LABEL_LENGTH = 300


// A preview, as /api/preview hands it to the compile function (see dispatch_job). The `kind`
// tells it apart from a version compile (CompileJob) in the compile function's handler
export interface PreviewJob {
    kind:'preview'
    uid:string
    preview_id:string
    design_id:string
    client_ip:string|null
    user_agent:string|null
    // 'svg' for a phone (pages in reading order), 'pdf' for a desktop (spreads)
    format:'svg'|'pdf'
    // Which window of a long document (the desktop's Start/Middle/End; a phone's is the start)
    section:PreviewSection
    // Advisory page-count estimate for the auto binding-gutter (see margin_gutter_auto)
    page_count?:number
    // The desktop's notices, in the UI's language (pdf only)
    labels?:PreviewLabels
    locale?:string
    dir?:TextDir
}


// A design that passed check_design(), with what the preview goes on to need from it
interface CheckedDesign {
    blueprint:Blueprint
    fonts_meta:StoredFontMeta[]
}


export function parse_preview_body(body:Record<string, unknown>)
        :Pick<PreviewJob, 'format'|'section'|'page_count'|'labels'|'locale'|'dir'>|null{
    // The preview's options from a request body, or null if they're malformed. A desktop's
    // preview needs every label, plus the locale and direction they're written in
    const format = body['format']
    const section = body['section'] ?? 'start'
    if ((format !== 'svg' && format !== 'pdf')
            || (section !== 'start' && section !== 'middle' && section !== 'end')){
        return null
    }
    const page_count = typeof body['page_count'] === 'number' && body['page_count'] > 0
        ? body['page_count'] : undefined
    if (format === 'svg'){
        return {format, section: 'start', ...page_count !== undefined && {page_count}}
    }
    const raw = body['labels'] as Record<string, unknown>|undefined
    const keys:(keyof PreviewLabels)[] = ['inside_cover', 'banner_title', 'banner_subtitle',
        'start_of_preview', 'end_of_preview', 'build_for_rest']
    if (!raw || typeof raw !== 'object' || keys.some(key =>
            typeof raw[key] !== 'string' || (raw[key] as string).length > MAX_LABEL_LENGTH)){
        return null
    }
    const locale = body['locale']
    const dir = body['dir']
    if (typeof locale !== 'string' || !/^[A-Za-z-]{2,20}$/.test(locale)
            || (dir !== 'ltr' && dir !== 'rtl')){
        return null
    }
    const labels = {} as PreviewLabels
    for (const key of keys){
        labels[key] = raw[key] as string
    }
    return {format, section, labels, locale, dir, ...page_count !== undefined && {page_count}}
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
        format: job.format,
        status: 'pending',
        created: FieldValue.serverTimestamp(),
        expires: Timestamp.fromMillis(Date.now() + PREVIEW_DOC_LIFETIME_MS),
        path: null,
        pages: null,
        page_estimate: null,
        truncated: null,
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

        // Resolved as the browser resolves it (see compile_preview_window in the app), with the
        // curated font manifest loaded first so script detection can match fallback styles
        await load_fonts_dir(config.fonts_dir)
        await shared_content.init()
        const share_url = `${config.app_url}/designs/${job.design_id}`
        const request = await shared_content.resolve(blueprint,
            Object.fromEntries(custom_fonts.map(font => [font.family, font.style])), undefined,
            share_url, job.page_count)
        const truncation = truncate_for_preview(request, job.section,
            job.format === 'svg' ? ESTIMATE_CHAR_LIMIT : PREVIEW_CHAR_LIMIT)
        const options = {typst_path: config.typst_path, fonts_dir: config.fonts_dir, custom_fonts}
        const scale = truncation.window_chars > 0
            ? truncation.total_chars / truncation.window_chars : 1
        const show_front_cover = !!blueprint.cover && !truncation.dropped_before

        compile_start = performance.now()
        let output:{bytes:Buffer, content_type:string, ext:string, pages:number,
            page_estimate:number}
        if (job.format === 'svg'){
            const pages = await compile_svg_preview(truncation.request, options)
            const page_estimate = estimate(pages.length, scale)
            const markup = pages.map(page => svg_page_markup(page))
            if (show_front_cover){
                markup.unshift(await render_cover_front_svg(blueprint, custom_fonts,
                    page_estimate, share_url))
            }
            output = {bytes: gzipSync(JSON.stringify({pages: markup})),
                content_type: 'application/json', ext: 'json', pages: markup.length,
                page_estimate}
        } else {
            const bytes = await compile_desktop_preview(job, truncation.request, blueprint,
                custom_fonts, share_url, show_front_cover, truncation.dropped_before,
                truncation.dropped_after, scale)
            output = {bytes: gzipSync(bytes.bytes), content_type: 'application/pdf', ext: 'pdf',
                pages: bytes.pages, page_estimate: bytes.page_estimate}
        }
        const preview_ms = performance.now() - compile_start

        // Stored gzipped (served with Content-Encoding, which browsers undo themselves), as a
        // phone may be fetching it over a slow connection
        const path =
            `${design_cache_prefix(job.design_id)}preview_${job.preview_id}.${output.ext}`
        await admin_bucket.file(path).save(output.bytes, {
            contentType: output.content_type,
            metadata: {contentEncoding: 'gzip', contentDisposition: 'inline'},
        })
        await doc_ref.update({status: 'available', path, pages: output.pages,
            page_estimate: output.page_estimate, truncated: truncation.truncated,
            dropped_after: truncation.dropped_after})
        void record_preview_stat(job, preview_ms, output.pages, true)
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
            context: {design_id: job.design_id, stage: `preview_${job.format}`},
        })
        await doc_ref.update({status: 'failed', error_id}).catch(() => undefined)
    }
}


function estimate(window_pages:number, scale:number):number{
    // The full document's page count from its window's, rounded to even since bound pages come
    // in twos — the same estimate the browser's preview gives (see compile_preview_window)
    return Math.max(2, Math.round(Math.max(1, window_pages) * scale / 2) * 2)
}


async function compile_desktop_preview(job:PreviewJob, request:TypstRequest,
        blueprint:Blueprint, custom_fonts:CustomFont[], share_url:string,
        show_front_cover:boolean, dropped_before:boolean, dropped_after:boolean, scale:number)
        :Promise<{bytes:Uint8Array, pages:number, page_estimate:number}>{
    // A desktop's live preview, as DisplayPreview.vue makes it in the browser: facing-page
    // spreads, the cover merged in front when the window starts at the document's start, and a
    // notice strip at each end, typeset in the UI's language from the labels the client sent
    const labels = job.labels!
    const standalone_options = {typst_path: config.typst_path, fonts_dir: config.fonts_dir}

    // The labelled "inside of the front cover" slot the first spread opens on
    let cover_slot:Uint8Array|undefined
    if (show_front_cover){
        request.preview_cover_label = labels.inside_cover
        cover_slot = await compile_standalone(notice_fonts(labels.inside_cover),
            fonts => gen_cover_slot_typst(request.page, labels.inside_cover, fonts),
            standalone_options)
    }
    let bytes = await compile_pdf_spread_preview(request,
        {typst_path: config.typst_path, fonts_dir: config.fonts_dir, custom_fonts}, cover_slot)
    // Reading spreads hold two book pages per PDF page (see compile_preview_window)
    const spreads = (await PDFDocument.load(bytes)).getPageCount()
    const page_estimate = estimate(spreads * 2, scale)

    if (show_front_cover){
        const cover = await render_cover(blueprint, custom_fonts, page_estimate, share_url)
        bytes = await prepend_cover(cover, bytes, cover_page_geometry(blueprint, page_estimate))
    }

    // The start strip always: "only a preview", or "start of preview" when the window dropped
    // what came before it; the end strip only when it dropped what follows
    const strip = async (title:string, subtitle:string, position:'start'|'end') => {
        const strip_pdf = await compile_standalone(notice_fonts(`${title} ${subtitle}`),
            fonts => gen_preview_strip_typst(request.page.width, title, subtitle, job.locale!,
                job.dir!, fonts), standalone_options)
        bytes = await add_preview_strip(bytes, strip_pdf, position)
    }
    await (dropped_before
        ? strip(labels.start_of_preview, labels.build_for_rest, 'start')
        : strip(labels.banner_title, labels.banner_subtitle, 'start'))
    if (dropped_after){
        await strip(labels.end_of_preview, labels.build_for_rest, 'end')
    }
    return {bytes, pages: spreads, page_estimate}
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
            kind: 'preview', format: job.format, design_id: job.design_id, owner: job.uid,
            engine: 'server', preview_ms, pages, ok, user_agent: job.user_agent,
            created: Timestamp.now(),
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
        })
    } catch (error){
        console.error(error)
    }
}
