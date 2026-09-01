
// Book-cover support: constants for the embedded cover editor (cover.paper.bible), a worker
// client that renders covers via the bookcover-web WASM package, a single-entry render cache
// (book-only edits reuse the previous cover render), bg-image Storage handling, and the
// freeze-time snapshot planning for versions.

import {PassageReference} from '@gracious.tech/fetch-client'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'
import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {make_blank_form_values, asset_path, BACKGROUNDS_DIR, resolve_dimensions}
    from 'bookcover-core'
import {cover_form_for_render, cover_render_key, STOCK_BG_PHOTOS, KNOWN_BUILTIN_BACKGROUNDS,
    doc_has_copyright, gen_copyright_typst, COPYRIGHT_MARKER, resolve_trim, convert_unit}
    from 'paper-bible-typst'
import {PDFDocument, rgb} from 'pdf-lib'

import {firebase_storage} from '@/services/firebase'
import {ASSETS_PREFIX} from '@/services/typst'
import {page_count_guess} from '@/services/state'
import {user} from '@/services/auth'
import {content} from '@/services/content'
import {custom_fonts} from '@/services/custom_fonts'
import {book_icon} from '@/services/icons'
import {get_passages} from '@/services/blueprints'

import type {DimensionInputs} from 'bookcover-core'
import type {ImageRegions} from 'bookcover-web'
import type {CustomFont} from 'typst-fonts'
import type {PmDoc} from 'paper-bible-typst'
import type {Blueprint, CoverConfig} from '@/services/types'
import type {CoverWorkerRequest, CoverWorkerResponse, CoverRenderResult, DistributiveOmit}
    from './cover_worker'


// The embedded cover editor (the bookcover widget) — a separate deployment/origin
export const COVER_EDITOR_URL = import.meta.env.PROD
    ? 'https://cover.paper.bible/'
    : 'http://localhost:5301/'
export const COVER_EDITOR_ORIGIN = new URL(COVER_EDITOR_URL).origin


// Background image types the cover editor accepts, and their Storage path extensions
const BG_MIME_EXT:Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
const BG_EXT_MIME = Object.fromEntries(
    Object.entries(BG_MIME_EXT).map(([mime, ext]) => [ext, mime]))


// Thematic default background per Bible book (fetch.bible book id -> backgrounds/ filename),
// used to seed the wizard's "photo" preset with an image matching the design's first passage
// rather than a random stock photo
const BOOK_BG_PHOTO:Record<string, string> = {
    'gen': 'earth_whole.jpg',
    'exo': 'israel.jpg',
    'lev': 'stars.jpg',
    'num': 'wilderness.jpg',
    'deu': 'lost_sheep.jpg',
    'jos': 'sword.jpg',
    'jdg': 'wasteland.jpg',
    'rut': 'crops.jpg',
    '1sa': 'crown.jpg',
    '2sa': 'crown.jpg',
    '1ki': 'crown.jpg',
    '2ki': 'crown.jpg',
    '1ch': 'crown.jpg',
    '2ch': 'crown.jpg',
    'ezr': 'growing.jpg',
    'neh': 'growing.jpg',
    'est': 'sunset.jpg',
    'job': 'wasteland.jpg',
    'psa': 'lake.jpg',
    'pro': 'hills_trees.jpg',
    'ecc': 'mist.jpg',
    'sng': 'flowers.jpg',
    'isa': 'israel_lake.jpg',
    'jer': 'israel_lake.jpg',
    'lam': 'wasteland.jpg',
    'ezk': 'israel_lake.jpg',
    'dan': 'lion.jpg',
    'hos': 'desert.jpg',
    'jol': 'crops.jpg',
    'amo': 'israel.jpg',
    'oba': 'israel.jpg',
    'jon': 'sea.jpg',
    'mic': 'israel.jpg',
    'nam': 'israel.jpg',
    'hab': 'israel.jpg',
    'zep': 'israel.jpg',
    'hag': 'israel.jpg',
    'zec': 'israel.jpg',
    'mal': 'israel.jpg',
    'mat': 'cross_sun.jpg',
    'mrk': 'cross_sun.jpg',
    'luk': 'cross_sun.jpg',
    'jhn': 'cross_sun.jpg',
    'act': 'church.jpg',
    'rom': 'opening.jpg',
    '1co': 'growing.jpg',
    '2co': 'growing.jpg',
    'gal': 'tomb.jpg',
    'eph': 'tomb.jpg',
    'php': 'tomb.jpg',
    'col': 'tomb.jpg',
    '1th': 'tomb.jpg',
    '2th': 'tomb.jpg',
    '1ti': 'church.jpg',
    '2ti': 'church.jpg',
    'tit': 'church.jpg',
    'phm': 'awe.jpg',
    'heb': 'hills.jpg',
    'jas': 'grass.jpg',
    '1pe': 'sheep.jpg',
    '2pe': 'burning.jpg',
    '1jn': 'green.jpg',
    '2jn': 'green.jpg',
    '3jn': 'green.jpg',
    'jud': 'cross.jpg',
    'rev': 'earth.jpg',
}

// Light background tint per Bible book grouping, used to tint the wizard's "pattern" preset
// (Material Design's "100" pastel shades — light but distinct enough to tell groups apart)
const BOOK_COLOR_GROUPS:{books:string[], color:string}[] = [
    {books: ['gen', 'exo', 'lev', 'num', 'deu'], color: '#c8e6c9'}, // Gen-Deu: light green
    {books: ['jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch', '2ch', 'ezr', 'neh', 'est'],
        color: '#ffcdd2'}, // Josh-Esther: light red
    {books: ['job', 'psa', 'pro', 'ecc', 'sng'], color: '#e1bee7'}, // Job-Song: light purple
    {books: ['isa', 'jer', 'lam', 'ezk', 'dan'], color: '#ffe0b2'}, // Isa-Dan: light orange
    {books: ['hos', 'jol', 'amo', 'oba', 'jon', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal'],
        color: '#fff9c4'}, // Hosea-Malachi: light yellow
    {books: ['mat', 'mrk', 'luk', 'jhn'], color: '#bbdefb'}, // Matt-John: light blue
    {books: ['act'], color: '#b2dfdb'}, // Acts: light teal
    {books: ['rom', '1co', '2co', 'gal', 'eph', 'php', 'col', '1th', '2th', '1ti', '2ti', 'tit',
        'phm'], color: '#d7ccc8'}, // Rom-Philemon: light brown
    {books: ['heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud', 'rev'],
        color: '#f8bbd0'}, // Heb-Rev: light pink
]
const BOOK_BG_COLOR:Record<string, string> = Object.fromEntries(
    BOOK_COLOR_GROUPS.flatMap(group => group.books.map(book => [book, group.color])))

// Dev-only guard: every BOOK_BG_PHOTO value must be a filename the shared package's
// KNOWN_BUILTIN_BACKGROUNDS allowlist also recognises, or that book's cover would silently
// fail schema validation and reset to no-cover on the next Firestore round-trip
if (import.meta.env.DEV){
    for (const filename of Object.values(BOOK_BG_PHOTO)){
        if (!KNOWN_BUILTIN_BACKGROUNDS.has(filename)){
            console.error(`BOOK_BG_PHOTO references unknown builtin background: ${filename}`)
        }
    }
}


// Client for the cover Web Worker (cover_worker.ts): a minimal id-tagged request/response
// relay. Unlike the book's TypstWorkerClient there's no recycle logic — covers are single
// pages, and the worker is only spawned at all for designs that actually have one
class CoverWorkerClient {

    private worker:Worker
    private next_id = 0
    private pending = new Map<number,
        {resolve:(result:CoverRenderResult|ImageRegions|null)=>void, reject:(error:Error)=>void}>()

    constructor(){
        this.worker = new Worker(new URL('./cover_worker.ts', import.meta.url), {type: 'module'})

        // Resolve/reject the matching call for each result
        this.worker.onmessage = (event:MessageEvent<CoverWorkerResponse>) => {
            const response = event.data
            const handlers = this.pending.get(response.id)
            if (!handlers){
                return
            }
            this.pending.delete(response.id)
            if (response.ok){
                handlers.resolve(response.result)
            } else {
                handlers.reject(new Error(response.error))
            }
        }

        // A crash of the worker script itself fails all in-flight calls, since no response
        // will ever arrive for them
        this.worker.onerror = event => {
            const error = new Error(event.message || 'Cover worker failed')
            for (const handlers of this.pending.values()){
                handlers.reject(error)
            }
            this.pending.clear()
        }
    }

    // Post one request to the worker and await its matching result
    send(action:DistributiveOmit<CoverWorkerRequest, 'id'>):Promise<CoverRenderResult|ImageRegions|null> {
        const id = this.next_id++
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject})
            this.worker.postMessage({...action, id})
        })
    }
}


// Lazy worker singleton — only spawned (and its ~28MB WASM fetched) once a cover render is
// actually needed, since most designs have no cover
let generator:CoverWorkerClient|null = null
let generator_ready:Promise<unknown>|null = null

// Font families last sent to the worker, to skip re-cloning font bytes when unchanged
let sent_fonts_key:string|null = null

function get_cover_generator():CoverWorkerClient {
    if (!generator){
        generator = new CoverWorkerClient()
        // Same shared assets tree the book compiler uses — bookcover's docs/frames/backgrounds
        // now live at its top level alongside fonts/ and the typst/ WASM dirs
        generator_ready = generator.send({action: 'init', assets_prefix: ASSETS_PREFIX})
    }
    return generator
}


// The custom font families a cover form references — every *_font field holds a family name
// ('' = widget default font), only those in the user's uploaded library count
export function cover_font_families(form:Record<string, unknown>):string[] {
    const library = new Set(toRaw(custom_fonts).map(font => font.family))
    const used = new Set<string>()
    for (const [key, value] of Object.entries(form)){
        if (key.endsWith('_font') && typeof value === 'string' && library.has(value)){
            used.add(value)
        }
    }
    return [...used].sort()
}


// Download a cover's bg image bytes — from the public assets bucket for a builtin (keyed by
// filename), from the user's Storage library for a custom upload (keyed by content hash).
// Both share one memoisation map: filenames and 64-char hex hashes can't realistically collide
const bg_cache = new Map<string, Promise<Uint8Array>>()

export async function load_cover_bg(cover:CoverConfig)
        :Promise<{data:Uint8Array, type:string}|null> {
    const bg = cover.bg_image
    if (!bg){
        return null
    }
    const [key, ext, fetch_bytes] = bg.kind === 'builtin'
        ? [bg.id, bg.id.slice(bg.id.lastIndexOf('.') + 1).toLowerCase(),
            () => fetch(asset_path(ASSETS_PREFIX, BACKGROUNDS_DIR, bg.id))
                .then(res => res.arrayBuffer()).then(buf => new Uint8Array(buf))]
        : [bg.hash, bg.path.slice(bg.path.lastIndexOf('.') + 1).toLowerCase(),
            () => getBytes(storage_ref(firebase_storage, bg.path)).then(buf => new Uint8Array(buf))]
    let bytes = bg_cache.get(key)
    if (!bytes){
        bytes = fetch_bytes()
        bg_cache.set(key, bytes)
        // Don't cache failures — a later call should retry the download
        bytes.catch(() => bg_cache.delete(key))
    }
    return {data: await bytes, type: BG_EXT_MIME[ext] ?? 'image/jpeg'}
}


// SHA-256 hex of some bytes (bg image identity for cache keys and upload dedup)
export async function hash_bytes(bytes:Uint8Array):Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}


// Upload a cover bg image to the user's library, content-addressed so re-saving a design with
// an unchanged image is idempotent. Returns the Storage path + hash to store on the blueprint
export async function upload_cover_bg(bytes:Uint8Array, mime:string)
        :Promise<{path:string, hash:string}> {
    const hash = await hash_bytes(bytes)
    const ext = BG_MIME_EXT[mime] ?? 'jpg'
    const path = `user_cover_images/${user.value!.uid}/${hash}.${ext}`
    await uploadBytes(storage_ref(firebase_storage, path), bytes, {contentType: mime})
    // Pre-warm the download cache — the bytes are already in hand
    bg_cache.set(hash, Promise.resolve(bytes))
    return {path, hash}
}


// Render a blueprint's cover via the worker, with a small bounded cache keyed by everything
// that affects the output (resolved form incl. size fields, bg image, font set, output format)
// — so book-only edits reuse a previous render untouched. Bounded (rather than the single slot
// this used to be) because the wizard now keeps several preview variants (photo/pattern/icon)
// warm simultaneously alongside the one real active cover. The worker always splits the
// wraparound render into its individual panels too (cheap post-process, not a second compile),
// so one render serves the full cover (Print preview, stored versions) and the front/back-only
// pages (Reading preview, and the wizard's front-only previews).
// `page_count` drives the spine width for real printing services — the interior PDF's actual
// count at version creation, the shared estimate during preview (see state.ts).
// `fonts` supplies a version's snapshotted custom fonts when regenerating (the live library
// is used otherwise, mirroring compile_and_upload in versions.ts).
// `opts.format`/`opts.image_override`/`opts.image_regions` exist only for the wizard's live
// preview cards (SVG output, a thumbnail image instead of an uploaded one, and precomputed
// regions since the thumbnail's bytes can never match bookcover's own builtin lookup by
// design — see get_bg_regions()) — real callers never pass them, so their output is
// byte-for-byte what it always was
const RENDER_CACHE_SIZE = 6
const render_cache:{key:string, result:CoverRenderResult}[] = []

async function render_cover(blueprint:Blueprint, page_count:number, fonts?:CustomFont[],
        opts?:{format?:'pdf'|'svg', image_override?:{data:Uint8Array, type:string, name?:string},
            image_regions?:ImageRegions|null, share_url?:string})
        :Promise<CoverRenderResult> {
    const cover = blueprint.cover
    if (!cover){
        throw new Error('render_cover called without a cover configured')
    }
    const format = opts?.format ?? 'pdf'
    const cover_fonts = (fonts ?? toRaw(custom_fonts))
        .filter(font => cover.font_families.includes(font.family))
    const fonts_key = (fonts ? 'snapshot:' : 'library:')
        + cover_fonts.map(font => font.family).join(',')

    // The default cover blurb carries the AUTO-COPYRIGHT marker (see default_cover_preset) —
    // resolve it to the design's full attribution statement here, where the blueprint and
    // translation licensing metadata live, and hand the finished Typst block to the worker to
    // splice into the rendered blurb (the cover-side counterpart to bible_content's interior
    // handling). Covers whose blurb has no marker send nothing extra
    const copyright_block = doc_has_copyright(cover.form['blurb'] as PmDoc | undefined)
        ? gen_copyright_typst(blueprint, content.translations, opts?.share_url)
        : undefined

    const key = cover_render_key(cover, blueprint, page_count) + '|' + fonts_key + '|' + format
        + (opts?.image_override ? '|preview:' + (opts.image_override.name ?? '') : '')
        + (copyright_block ? '|copyright:' + copyright_block : '')
    const cached = render_cache.find(entry => entry.key === key)
    if (cached){
        return cached.result
    }

    const client = get_cover_generator()
    await generator_ready

    // Send the cover's custom fonts only when the set changed (bytes are expensive to
    // structured-clone; the worker holds them so identities stay stable for its cache)
    if (fonts_key !== sent_fonts_key){
        await client.send({action: 'set_custom_fonts', fonts: cover_fonts})
        sent_fonts_key = fonts_key
    }

    const image = opts?.image_override ?? await load_cover_bg(cover)
    // Real (non-preview) images are named after the builtin id when applicable, so bookcover's
    // own fast color lookup can match filename+bytes instead of falling back to a live decode
    const name = opts?.image_override?.name
        ?? (cover.bg_image?.kind === 'builtin' ? cover.bg_image.id : undefined)
    // Deep-clone: `cover.form` is Vue-reactive, and a shallow spread (cover_form_for_render)
    // leaves nested values (e.g. the blurb doc) wrapped in Proxies — postMessage's structured
    // clone rejects Proxy objects outright, so the worker call must get plain data only
    const result = await client.send({
        action: 'generate',
        form: cloneDeep(cover_form_for_render(cover, blueprint, page_count)),
        image: image && {data: image.data, type: image.type, ...name !== undefined && {name}},
        ...opts?.image_regions !== undefined && {image_regions: opts.image_regions},
        ...copyright_block !== undefined && {copyright_block},
        format,
    }) as CoverRenderResult
    render_cache.push({key, result})
    if (render_cache.length > RENDER_CACHE_SIZE){
        render_cache.shift()
    }
    return result
}


// The full wraparound cover PDF (front + spine + back as one page) — used for the Print
// preview and as the stored version's cover.pdf
export async function render_cover_pdf(blueprint:Blueprint, page_count:number,
        fonts?:CustomFont[], share_url?:string):Promise<Uint8Array> {
    return (await render_cover(blueprint, page_count, fonts,
        share_url !== undefined ? {share_url} : undefined)).data as Uint8Array
}


// The cover's front and back panels only, each already cropped to its own page — used for the
// Reading preview, which simulates opening the book and never shows the spine as a page
export async function render_cover_pages(blueprint:Blueprint, page_count:number,
        fonts?:CustomFont[], share_url?:string):Promise<{front:Uint8Array, back:Uint8Array}> {
    const {front, back} = await render_cover(blueprint, page_count, fonts,
        share_url !== undefined ? {share_url} : undefined)
    return {front: front as Uint8Array, back: back as Uint8Array}
}


// Build the full form preset for a design's first cover: blank widget values with the book's
// title (or first passage reference), the first included Bible book's icon as the background
// design, a minimal blurb crediting paper.bible, and the blueprint's own size fields
export function default_cover_preset(blueprint:Blueprint):Record<string, unknown> {
    // make_blank_form_values returns the live FormState shape — drop the bg_image binary slot
    const {bg_image: _, ...blank} = make_blank_form_values()
    const form:Record<string, unknown> = blank

    // Title from the design, falling back to the first passage's reference ("Titus" etc)
    const passage = get_passages(blueprint)[0]
    let title = blueprint.title
    if (!title && passage){
        title = content.collection.reference_to_string(
            new PassageReference(passage), blueprint.bibles[0])
    }
    form['title1'] = title

    // Rear blurb: the AUTO-COPYRIGHT marker (same one the interior "Copyright" page uses),
    // resolved to the design's full attribution statement at render time (render_cover here,
    // the server compile in compile.ts). gen_copyright_typst appends its own "Created with
    // paper.bible" line when the blueprint's app_link is set
    form['blurb'] = {type: 'doc', content: [{type: 'paragraph', content: [
        {type: 'text', text: COPYRIGHT_MARKER}]}]}

    // Home printers can't reach the paper edge, so default the white-margin matte on for
    // home printing (the user can still turn it off in the cover widget)
    form['home_print_margin'] = blueprint.service_id === 'home'

    // Narrow books (interior trim under 5.5") get a tighter back-panel margin — bookcover's own
    // default (a percentage of face height) leaves too little width for the blurb on a small
    // back panel. Seeded once here at creation as an explicit form value, so it's independent
    // of whatever bookcover's default happens to be; it's a normal form field afterwards (the
    // user can change it in the cover editor, and it doesn't follow later page-size changes)
    const trim = resolve_trim(blueprint)
    if (convert_unit(trim.width, trim.unit, 'in') < 5.5){
        form['margin_back'] = 3
    }

    // Size fields always mirror the blueprint (the widget's size UI is hidden when embedded),
    // with the current page-count guess standing in for the not-yet-compiled interior
    return cover_form_for_render(
        {form, bg_image: null, font_families: []}, blueprint,
        page_count_guess())
}


// Build the form for the new-design wizard's Photo / Pattern / Icon / Minimal presets, plus the
// builtin background id for the photo preset — shared by seed_cover_preset() and
// render_wizard_cover_preview(). No I/O: the photo preset only picks a filename here, bytes
// (thumbnail for preview, full-res on demand for a real render) are fetched by the caller
function build_cover_preset_form(kind:'photo'|'pattern'|'icon'|'minimal', blueprint:Blueprint)
        :{form:Record<string, unknown>, bg_image_id:string|null} {

    // Base: blank values plus the title from the first passage, its book's icon and a credit
    // blurb (icon preset uses this as-is)
    const form = default_cover_preset(blueprint)
    const passage = get_passages(blueprint)[0]
    if (kind === 'pattern'){
        // Full-cover vector background with an offset icon overlay, tinted per the first
        // included passage's book grouping
        form['bg_vector_id'] = 'facet-corner'
        form['pattern_id'] = 'morphing-diamonds'
        form['icon_id'] = 'builtin:cross'
        form['icon_mode'] = 'offset'
        form['icon_size'] = 0.8
        const bg_color = passage && BOOK_BG_COLOR[passage.book]
        if (bg_color){
            // Icon matches the background exactly, so it reads as part of the pattern rather
            // than a separate overlay
            form['bg_color'] = bg_color
            form['icon_color'] = bg_color
        }
        return {form, bg_image_id: null}
    }
    if (kind === 'icon' || kind === 'minimal'){
        form['icon_id'] = passage?.book ? book_icon[passage.book] : 'game-icons:open-book'
        if (kind === 'minimal'){
            // Ink-efficient for home printing: no pattern, plain (unfilled) background, and a
            // solid black icon rather than a book-themed tint
            form['icon_color'] = '#000000'
        } else {
            form['pattern_id'] = 'diagonal-lines'
            // Tint the background to match the first included passage's book grouping
            if (passage && BOOK_BG_COLOR[passage.book]){
                form['bg_color'] = BOOK_BG_COLOR[passage.book]
            }
        }
        return {form, bg_image_id: null}
    }
    if (kind === 'photo'){
        // Full-spread photo mode. Prefer a background themed to the first included passage's
        // book, falling back to a random stock photo when there isn't one
        form['icon_id'] = null
        form['bg_image_coverage'] = 'full'
        const filename = (passage && BOOK_BG_PHOTO[passage.book])
            || STOCK_BG_PHOTOS[Math.floor(Math.random() * STOCK_BG_PHOTOS.length)]!
        return {form, bg_image_id: filename}
    }
    return {form, bg_image_id: null}
}


// Seed a cover config for the new-design wizard's Photo / Pattern / Icon / Minimal presets — a
// complete form the user refines later in the cover widget (DialogCoverEditor round-trips
// cover.form through cover_form_for_render on open, so any full form shape here reopens cleanly
// there). The photo preset references a builtin stock/thematic background directly — no fetch,
// no upload, it's already durably hosted in the public assets bucket
export function seed_cover_preset(kind:'photo'|'pattern'|'icon'|'minimal', blueprint:Blueprint)
        :CoverConfig{
    const {form, bg_image_id} = build_cover_preset_form(kind, blueprint)
    return {form, bg_image: bg_image_id ? {kind: 'builtin', id: bg_image_id} : null,
        font_families: []}
}


// Sample a builtin background's dominant colors once (full-resolution original, so it can hit
// bookcover's own fast lookup table), cached forever per filename — the known builtin set is
// small (~35 filenames) so no bound/eviction is needed. Only ever consumed by the wizard
// preview below: it's sampled with dims:null, so front_top_full/back/spine come back null —
// fine for a front-only preview, not safe to reuse for a full wraparound render
const bg_regions_cache = new Map<string, Promise<ImageRegions>>()

async function get_bg_regions(id:string):Promise<ImageRegions> {
    let cached = bg_regions_cache.get(id)
    if (!cached){
        cached = (async () => {
            const ext = id.slice(id.lastIndexOf('.') + 1).toLowerCase()
            const url = asset_path(ASSETS_PREFIX, BACKGROUNDS_DIR, id)
            const data = new Uint8Array(await (await fetch(url)).arrayBuffer())
            const client = get_cover_generator()
            await generator_ready
            return await client.send({action: 'analyze_regions',
                image: {data, type: BG_EXT_MIME[ext] ?? 'image/jpeg', name: id}}) as ImageRegions
        })()
        bg_regions_cache.set(id, cached)
        // Don't cache failures — a later call should retry
        cached.catch(() => bg_regions_cache.delete(id))
    }
    return cached
}


// Render one of the wizard's Photo / Pattern / Icon / Minimal presets straight to an SVG string
// (front panel only, no Storage upload — this is a disposable preview, not a saved cover) for
// the wizard's cover-selection cards. Goes through the exact same build_cover_preset_form() +
// render_cover() as real creation/compiling; only the image variant (thumbnail) and output
// format (svg) differ
export async function render_wizard_cover_preview(kind:'photo'|'pattern'|'icon'|'minimal',
        blueprint:Blueprint):Promise<string> {
    const {form, bg_image_id} = build_cover_preset_form(kind, blueprint)
    const cover:CoverConfig = {form,
        bg_image: bg_image_id ? {kind: 'builtin', id: bg_image_id} : null, font_families: []}
    let image_override:{data:Uint8Array, type:string, name:string}|undefined
    let image_regions:ImageRegions|undefined
    if (bg_image_id){
        const ext = bg_image_id.slice(bg_image_id.lastIndexOf('.') + 1).toLowerCase()
        const thumb_url = asset_path(ASSETS_PREFIX, BACKGROUNDS_DIR, 'previews', bg_image_id)
        const [thumb_bytes, regions] = await Promise.all([
            fetch(thumb_url).then(res => res.arrayBuffer()).then(buf => new Uint8Array(buf)),
            get_bg_regions(bg_image_id),
        ])
        image_override = {data: thumb_bytes, type: BG_EXT_MIME[ext] ?? 'image/jpeg', name: bg_image_id}
        image_regions = regions
    }
    const result = await render_cover({...blueprint, cover}, page_count_guess(), undefined,
        {format: 'svg', ...image_override && {image_override}, ...image_regions && {image_regions}})
    return result.front as string
}


// Snapshot a blueprint's cover for an immutable version: a custom bg image is re-uploaded
// under the version's own Storage prefix (mirroring plan_version_fonts), so regeneration
// never depends on the user's mutable image library. A builtin needs no snapshot at all — it's
// an immutable, publicly-hosted asset already, referenced by id rather than any mutable path.
// Returns the CoverConfig to freeze on the version doc plus the upload to send once the doc
// exists (Storage rules require that ordering)
export async function plan_version_cover(version_id:string, blueprint:Blueprint)
        :Promise<{frozen:CoverConfig|null, uploads:[string, Uint8Array, string][]}> {
    const cover = blueprint.cover
    if (!cover){
        return {frozen: null, uploads: []}
    }
    const frozen = cloneDeep(toRaw(cover))
    if (!cover.bg_image || cover.bg_image.kind === 'builtin'){
        return {frozen, uploads: []}
    }
    const image = await load_cover_bg(cover)
    if (!image){
        return {frozen, uploads: []}
    }
    const ext = cover.bg_image.path.slice(cover.bg_image.path.lastIndexOf('.') + 1)
    const path = `versions/${version_id}/cover/bg.${ext}`
    frozen.bg_image = {kind: 'custom', path, hash: cover.bg_image.hash}
    return {frozen, uploads: [[path, image.data, image.type]]}
}


// Prepend a rendered cover (its single wraparound page) to a book PDF, for the Print preview
// only — stored versions keep the cover as its own separate cover.pdf. The page is cropped to
// its trim box (bleed hidden) and gets two 50%-gray guide lines marking the spine's left and
// right edges. Both are preview aids: the content is untouched and the real cover PDF is
// produced by a different path
export async function prepend_cover_page(cover_bytes:Uint8Array, book_bytes:Uint8Array,
        blueprint:Blueprint, page_count:number):Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    const cover_doc = await PDFDocument.load(cover_bytes)
    const [cover_page] = await book.copyPages(cover_doc, [0])

    // Use the same dimensions bookcover uses to split the wraparound into panels — its layout
    // is mm-based, the page is pt, so convert mm -> pt exactly as bookcover's splitter does.
    // Region y is top-down; pdf boxes are bottom-up (origin at the page's bottom-left)
    if (blueprint.cover){
        const dims = resolve_dimensions(cover_form_for_render(
            blueprint.cover, blueprint, page_count) as unknown as DimensionInputs)
        const mm_to_pt = (mm:number) => mm / 25.4 * 72
        const page_h = cover_page!.getHeight()
        const back = dims.cover_region_back
        const front = dims.cover_region_front

        // Crop to the trim box (drop the bleed) — a display-only crop, content is preserved
        if (dims.cover_has_bleed){
            const left = mm_to_pt(back.x.toNumber())
            const right = mm_to_pt(front.x.toNumber() + front.w.toNumber())
            const bottom = page_h - mm_to_pt(back.y.toNumber() + back.h.toNumber())
            cover_page!.setCropBox(left, bottom, right - left, mm_to_pt(back.h.toNumber()))
        }

        // Spine guide lines at the spine region's left and right edges (clipped by the crop
        // box above to the visible trim height)
        if (dims.cover_has_spine){
            const spine_left = dims.cover_region_spine.x.toNumber()
            const spine_right = spine_left + dims.cover_region_spine.w.toNumber()
            const gray = rgb(0.5, 0.5, 0.5)
            for (const x of [mm_to_pt(spine_left), mm_to_pt(spine_right)]){
                cover_page!.drawLine({
                    start: {x, y: 0},
                    end: {x, y: page_h},
                    thickness: 0.5,
                    color: gray,
                })
            }
        }
    }

    book.insertPage(0, cover_page!)
    return book.save()
}


// Wrap a book PDF with the cover's front and back panels for the Reading preview — front as
// page 1, back as the last page, spine omitted (a reader never sees the spine as its own
// page). Either panel may be null to skip it, for a truncated preview whose window doesn't
// reach that end of the document.
export async function wrap_cover_reading_pages(front_bytes:Uint8Array|null,
        back_bytes:Uint8Array|null, book_bytes:Uint8Array):Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    // Front panel as the new page 1
    if (front_bytes){
        const front_doc = await PDFDocument.load(front_bytes)
        const [front_page] = await book.copyPages(front_doc, [0])
        book.insertPage(0, front_page!)
    }
    // Back panel as the new last page
    if (back_bytes){
        const back_doc = await PDFDocument.load(back_bytes)
        const [back_page] = await book.copyPages(back_doc, [0])
        book.addPage(back_page!)
    }
    return book.save()
}
