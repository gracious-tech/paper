
// Book-cover support: constants for the embedded cover editor (cover.paper.bible), a worker
// client that renders covers via the bookcover-web WASM package, a single-entry render cache
// (book-only edits reuse the previous cover render), bg-image Storage handling, and the
// freeze-time snapshot planning for versions.

import {PassageReference} from '@gracious.tech/fetch-client'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'
import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {make_blank_form_values} from 'bookcover-core'
import {cover_form_for_render, cover_render_key} from 'paper-bible-typst'
import {PDFDocument} from 'pdf-lib'

import {firebase_storage} from '@/services/firebase'
import {ASSETS_PREFIX} from '@/services/typst'
import {user} from '@/services/auth'
import {content} from '@/services/content'
import {custom_fonts} from '@/services/custom_fonts'
import {book_icon} from '@/services/icons'
import {get_passages} from '@/services/blueprints'

import type {CustomFont} from 'typst-fonts'
import type {Blueprint, CoverConfig} from '@/services/types'
import type {CoverWorkerRequest, CoverWorkerResponse, CoverRenderResult} from './cover_worker'


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
    send(action:Omit<CoverWorkerRequest, 'id'>):Promise<CoverRenderResult|null> {
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


// Render a blueprint's cover via the worker, with a single-entry cache keyed by everything that
// affects the output (resolved form incl. size fields, bg image, font set) — so book-only edits
// reuse the previous render untouched. The worker always splits the wraparound PDF into its
// individual panels too (cheap CropBox post-process, not a second compile), so one render serves
// both the full cover (Print preview, stored versions) and the front/back-only pages (Reading
// preview, which never shows the spine as its own page).
// `fonts` supplies a version's snapshotted custom fonts when regenerating (the live library
// is used otherwise, mirroring compile_and_upload in versions.ts)
let render_cache:{key:string, result:CoverRenderResult}|null = null

async function render_cover(blueprint:Blueprint, fonts?:CustomFont[])
        :Promise<CoverRenderResult> {
    const cover = blueprint.cover
    if (!cover){
        throw new Error('render_cover called without a cover configured')
    }
    const cover_fonts = (fonts ?? toRaw(custom_fonts))
        .filter(font => cover.font_families.includes(font.family))
    const fonts_key = (fonts ? 'snapshot:' : 'library:')
        + cover_fonts.map(font => font.family).join(',')
    const key = cover_render_key(cover, blueprint) + '|' + fonts_key
    if (render_cache?.key === key){
        return render_cache.result
    }

    const client = get_cover_generator()
    await generator_ready

    // Send the cover's custom fonts only when the set changed (bytes are expensive to
    // structured-clone; the worker holds them so identities stay stable for its cache)
    if (fonts_key !== sent_fonts_key){
        await client.send({action: 'set_custom_fonts', fonts: cover_fonts})
        sent_fonts_key = fonts_key
    }

    const image = await load_cover_bg(cover)
    // Deep-clone: `cover.form` is Vue-reactive, and a shallow spread (cover_form_for_render)
    // leaves nested values (e.g. the blurb doc) wrapped in Proxies — postMessage's structured
    // clone rejects Proxy objects outright, so the worker call must get plain data only
    const result = await client.send({
        action: 'generate',
        form: cloneDeep(cover_form_for_render(cover, blueprint)),
        image,
    }) as CoverRenderResult
    render_cache = {key, result}
    return result
}


// The full wraparound cover PDF (front + spine + back as one page) — used for the Print
// preview and as the stored version's cover.pdf
export async function render_cover_pdf(blueprint:Blueprint, fonts?:CustomFont[])
        :Promise<Uint8Array> {
    return (await render_cover(blueprint, fonts)).data
}


// The cover's front and back panels only, each already cropped to its own page — used for the
// Reading preview, which simulates opening the book and never shows the spine as a page
export async function render_cover_pages(blueprint:Blueprint, fonts?:CustomFont[])
        :Promise<{front:Uint8Array, back:Uint8Array}> {
    const {front, back} = await render_cover(blueprint, fonts)
    return {front, back}
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

    // Size fields always mirror the blueprint (the widget's size UI is hidden when embedded)
    return cover_form_for_render(
        {form, bg_image_path: null, bg_image_hash: null, font_families: []}, blueprint)
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
