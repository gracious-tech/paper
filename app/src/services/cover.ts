
// Book-cover support: constants for the embedded cover editor (cover.paper.bible), a worker
// client that renders covers via the bookcover-web WASM package, a single-entry render cache
// (book-only edits reuse the previous cover render), bg-image Storage handling, and the
// freeze-time snapshot planning for versions.

import {PassageReference} from '@gracious.tech/fetch-client'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'
import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {make_blank_form_values, list_patterns, asset_path, BACKGROUNDS_DIR} from 'bookcover-core'
import {cover_form_for_render, cover_render_key} from 'paper-bible-typst'
import {PDFDocument} from 'pdf-lib'

import {firebase_storage} from '@/services/firebase'
import {ASSETS_PREFIX} from '@/services/typst'
import {page_count_guess} from '@/services/state'
import {user} from '@/services/auth'
import {content} from '@/services/content'
import {custom_fonts} from '@/services/custom_fonts'
import {book_icon} from '@/services/icons'
import {get_passages} from '@/services/blueprints'

import type {CustomFont} from 'typst-fonts'
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


// Stock photos in the assets bucket's backgrounds/ dir, offered as the wizard's "photo" preset
// (no listing API exists for them — see BACKGROUNDS_DIR — so the set is hardcoded here)
const STOCK_BG_PHOTOS = [
    'black_hills_trees.jpg',
    'black_hills.jpg',
    'black_snow_trees.jpg',
    'white_stars.jpg',
]


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


// Client for the cover Web Worker (cover_worker.ts): a minimal id-tagged request/response
// relay. Unlike the book's TypstWorkerClient there's no recycle logic — covers are single
// pages, and the worker is only spawned at all for designs that actually have one
class CoverWorkerClient {

    private worker:Worker
    private next_id = 0
    private pending = new Map<number,
        {resolve:(result:CoverRenderResult|null)=>void, reject:(error:Error)=>void}>()

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
    send(action:DistributiveOmit<CoverWorkerRequest, 'id'>):Promise<CoverRenderResult|null> {
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


// Download a cover's bg image bytes from Storage, memoised by content hash (the same image is
// re-used across renders, editor re-opens and version freezing)
const bg_cache = new Map<string, Promise<Uint8Array>>()

export async function load_cover_bg(cover:CoverConfig)
        :Promise<{data:Uint8Array, type:string}|null> {
    if (!cover.bg_image_path || !cover.bg_image_hash){
        return null
    }
    const path = cover.bg_image_path
    let bytes = bg_cache.get(cover.bg_image_hash)
    if (!bytes){
        bytes = getBytes(storage_ref(firebase_storage, path)).then(buf => new Uint8Array(buf))
        bg_cache.set(cover.bg_image_hash, bytes)
        // Don't cache failures — a later call should retry the download
        bytes.catch(() => bg_cache.delete(cover.bg_image_hash!))
    }
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
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
// `opts.format`/`opts.image_override` exist only for the wizard's live preview cards (SVG
// output, a thumbnail image instead of an uploaded one) — real callers never pass them, so
// their output is byte-for-byte what it always was
const RENDER_CACHE_SIZE = 6
const render_cache:{key:string, result:CoverRenderResult}[] = []

async function render_cover(blueprint:Blueprint, page_count:number, fonts?:CustomFont[],
        opts?:{format?:'pdf'|'svg', image_override?:{data:Uint8Array, type:string}})
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
    const key = cover_render_key(cover, blueprint, page_count) + '|' + fonts_key + '|' + format
        + (opts?.image_override ? '|preview' : '')
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
    // Deep-clone: `cover.form` is Vue-reactive, and a shallow spread (cover_form_for_render)
    // leaves nested values (e.g. the blurb doc) wrapped in Proxies — postMessage's structured
    // clone rejects Proxy objects outright, so the worker call must get plain data only
    const result = await client.send({
        action: 'generate',
        form: cloneDeep(cover_form_for_render(cover, blueprint, page_count)),
        image,
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
        fonts?:CustomFont[]):Promise<Uint8Array> {
    return (await render_cover(blueprint, page_count, fonts)).data as Uint8Array
}


// The cover's front and back panels only, each already cropped to its own page — used for the
// Reading preview, which simulates opening the book and never shows the spine as a page
export async function render_cover_pages(blueprint:Blueprint, page_count:number,
        fonts?:CustomFont[]):Promise<{front:Uint8Array, back:Uint8Array}> {
    const {front, back} = await render_cover(blueprint, page_count, fonts)
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

    // Default background design: the icon of the first included Bible book
    if (passage && book_icon[passage.book]){
        form['icon_id'] = book_icon[passage.book]
        form['icon_mode'] = 'center'
    }

    // Minimal rear blurb crediting the app
    form['blurb'] = {type: 'doc', content: [{type: 'paragraph', content: [
        {type: 'text', text: "Created with paper.bible"}]}]}

    // Size fields always mirror the blueprint (the widget's size UI is hidden when embedded),
    // with the current page-count guess standing in for the not-yet-compiled interior
    return cover_form_for_render(
        {form, bg_image_path: null, bg_image_hash: null, font_families: []}, blueprint,
        page_count_guess())
}


// Build the form (and, for the photo preset, the bg image bytes) for the new-design wizard's
// Photo / Pattern / Icon presets — shared by both the real seed_cover_preset() (uploads the
// image to the user's library) and render_wizard_cover_preview() (renders it straight to SVG,
// no upload). `image_variant` is the only thing that differs between those two callers: the
// wizard preview asks for the lightweight `previews/` copy to keep the compile fast, real
// creation asks for the full-resolution original
async function build_cover_preset_form(kind:'photo'|'pattern'|'icon', blueprint:Blueprint,
        image_variant:'full'|'thumbnail'):Promise<{form:Record<string, unknown>,
        image:{data:Uint8Array, mime:string}|null}> {

    // Base: blank values plus the title from the first passage, its book's icon and a credit
    // blurb (icon preset uses this as-is)
    const form = default_cover_preset(blueprint)
    if (kind === 'pattern'){
        // Swap the icon for a default pattern (first of bookcover's built-ins)
        form['icon_id'] = null
        form['pattern_id'] = list_patterns()[0]!.id
        return {form, image: null}
    }
    if (kind === 'photo'){
        // Full-spread photo mode. Prefer a background themed to the first included passage's
        // book, falling back to a random stock photo when there isn't one
        form['icon_id'] = null
        form['bg_image_coverage'] = 'full'
        const passage = get_passages(blueprint)[0]
        const filename = (passage && BOOK_BG_PHOTO[passage.book])
            || STOCK_BG_PHOTOS[Math.floor(Math.random() * STOCK_BG_PHOTOS.length)]!
        const url = image_variant === 'thumbnail'
            ? asset_path(ASSETS_PREFIX, BACKGROUNDS_DIR, 'previews', filename)
            : asset_path(ASSETS_PREFIX, BACKGROUNDS_DIR, filename)
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
        const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
        return {form, image: {data: bytes, mime: BG_EXT_MIME[ext] ?? 'image/jpeg'}}
    }
    return {form, image: null}
}


// Seed a cover config for the new-design wizard's Photo / Pattern / Icon presets — a complete
// form the user refines later in the cover widget (DialogCoverEditor round-trips cover.form
// through cover_form_for_render on open, so any full form shape here reopens cleanly there).
// Async because the photo preset fetches + uploads a full-resolution stock background
export async function seed_cover_preset(kind:'photo'|'pattern'|'icon', blueprint:Blueprint)
        :Promise<CoverConfig>{
    const {form, image} = await build_cover_preset_form(kind, blueprint, 'full')
    let bg_image_path:string|null = null
    let bg_image_hash:string|null = null
    if (image){
        // Re-uploaded to the user's own library (content-addressed) the same way the widget's
        // own upload flow would
        ;({path: bg_image_path, hash: bg_image_hash} = await upload_cover_bg(image.data, image.mime))
    }
    return {form, bg_image_path, bg_image_hash, font_families: []}
}


// Render one of the wizard's Photo / Pattern / Icon presets straight to an SVG string (front
// panel only, no Storage upload — this is a disposable preview, not a saved cover) for the
// wizard's cover-selection cards. Goes through the exact same build_cover_preset_form() +
// render_cover() as real creation/compiling; only the image variant (thumbnail) and output
// format (svg) differ, both passed as plain parameters
export async function render_wizard_cover_preview(kind:'photo'|'pattern'|'icon',
        blueprint:Blueprint):Promise<string> {
    const {form, image} = await build_cover_preset_form(kind, blueprint, 'thumbnail')
    const cover:CoverConfig = {form, bg_image_path: null, bg_image_hash: null, font_families: []}
    const result = await render_cover({...blueprint, cover}, page_count_guess(), undefined,
        {format: 'svg', ...image && {image_override: {data: image.data, type: image.mime}}})
    return result.front as string
}


// Snapshot a blueprint's cover for an immutable version: the bg image is re-uploaded under the
// version's own Storage prefix (mirroring plan_version_fonts), so regeneration never depends
// on the user's mutable image library. Returns the CoverConfig to freeze on the version doc
// plus the upload to send once the doc exists (Storage rules require that ordering)
export async function plan_version_cover(version_id:string, blueprint:Blueprint)
        :Promise<{frozen:CoverConfig|null, uploads:[string, Uint8Array, string][]}> {
    const cover = blueprint.cover
    if (!cover){
        return {frozen: null, uploads: []}
    }
    const frozen = cloneDeep(toRaw(cover))
    if (!cover.bg_image_path){
        return {frozen, uploads: []}
    }
    const image = await load_cover_bg(cover)
    if (!image){
        return {frozen, uploads: []}
    }
    const ext = cover.bg_image_path.slice(cover.bg_image_path.lastIndexOf('.') + 1)
    const path = `versions/${version_id}/cover/bg.${ext}`
    frozen.bg_image_path = path
    return {frozen, uploads: [[path, image.data, image.type]]}
}


// Prepend a rendered cover (its single wraparound page) to a book PDF, for the Print preview
// only — stored versions keep the cover as its own separate cover.pdf
export async function prepend_cover_page(cover_bytes:Uint8Array, book_bytes:Uint8Array)
        :Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    const cover_doc = await PDFDocument.load(cover_bytes)
    const [cover_page] = await book.copyPages(cover_doc, [0])
    book.insertPage(0, cover_page!)
    return book.save()
}


// Wrap a book PDF with the cover's front and back panels for the Reading preview — front as
// page 1, back as the last page, spine omitted (a reader never sees the spine as its own page)
export async function wrap_cover_reading_pages(front_bytes:Uint8Array, back_bytes:Uint8Array,
        book_bytes:Uint8Array):Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    const front_doc = await PDFDocument.load(front_bytes)
    const back_doc = await PDFDocument.load(back_bytes)
    const [front_page] = await book.copyPages(front_doc, [0])
    const [back_page] = await book.copyPages(back_doc, [0])
    book.insertPage(0, front_page!)
    book.addPage(back_page!)
    return book.save()
}
