
// Web Worker that owns the WASM Typst compiler, so PDF compilation (which can take seconds for
// large documents) runs off the main thread and never lags the UI. Driven by TypstWorkerClient
// in typst.ts via simple id-tagged request/response messages.
//
// It also owns every pdf-lib post-processing step the app needs (page counts, the preview
// notice strips, merging a rendered cover into a preview). pdf-lib is a ~700KB dependency that
// the compile pipeline in paper-bible-typst already pulls in here, so keeping these beside the
// compiler both keeps that weight out of the main bundle and stops a multi-megabyte PDF being
// parsed on the UI thread.

import {version as compiler_version} from '@myriaddreamin/typst-ts-web-compiler/package.json'
import {version as renderer_version} from '@myriaddreamin/typst-ts-renderer/package.json'
import {init as init_typst} from 'paper-bible-typst-web'
import {add_preview_strip, collect_fonts} from 'paper-bible-typst'
import {PDFDocument, rgb} from 'pdf-lib'

import type {TypstWeb} from 'paper-bible-typst-web'
import type {CustomFont} from 'typst-fonts'
import type {TypstRequest, ProgressEvent} from 'paper-bible-typst'


// Where a rendered wraparound cover's trim box and fold guide lines fall, in PDF points, as
// resolved from bookcover's mm-based layout by the caller (see cover_page_geometry in cover.ts)
// — passing plain numbers keeps bookcover-core out of this worker's bundle
export interface CoverPageGeometry {
    // Trim box to crop to, measured from the page's top-left (bookcover's regions are top-down;
    // the worker flips y for PDF's bottom-up origin), or null when the cover has no bleed to hide
    crop:{left:number, top:number, width:number, height:number}|null
    // X positions of the 50%-gray fold guide lines
    fold_x:number[]
}

// Actions the main thread can request (see TypstWorkerClient in typst.ts). A compile_pdf that
// carries `fonts` uses exactly those custom fonts for that one compile instead of the open
// design's set (a version's own fonts, which must not depend on which design is open by the time
// its compile reaches the front of the queue)
export type WorkerAction =
    | {action:'init', assets_prefix:string}
    | {action:'set_custom_fonts', fonts:CustomFont[]}
    | {action:'compile_pdf', request:TypstRequest, preview?:boolean, fonts?:CustomFont[]}
    | {action:'compile_pdf_preview', request:TypstRequest}
    | {action:'compile_svg', request:TypstRequest}
    | {action:'page_count', pdf:Uint8Array}
    | {action:'preview_strip', pdf:Uint8Array, page_width:string, title:string, subtitle:string,
        position:'start'|'end'}
    | {action:'prepend_cover', cover:Uint8Array, book:Uint8Array, geometry:CoverPageGeometry|null}

// Every request carries an id, echoed back in the matching response
export type WorkerRequest = WorkerAction & {id:number}

// A coarse progress update for an in-flight compile, keyed by the same id as its request. Any
// number of these may arrive before the matching WorkerResult
export type WorkerProgress = {id:number, kind:'progress', event:ProgressEvent}

// Final response to a request: PDF bytes for the PDF actions, an SVG string for compile_svg, a
// number for page_count, null for init/set_custom_fonts. `pages` accompanies the PDF bytes of a
// compile action, counted here so the main thread never has to parse the document itself.
// worn = the WASM compiler has permanently accumulated enough memory that this whole worker
// should be recycled (see TypstWeb.worn). fatal = the error was a WASM trap (e.g. an
// out-of-memory abort), which poisons the compiler for good — the worker must be recycled
// before any further compile can succeed. Both are acted on by TypstWorkerClient in typst.ts.
export type WorkerResult =
    | {id:number, kind:'result', ok:true, result:Uint8Array|string|number|null, pages:number|null,
        worn:boolean}
    | {id:number, kind:'result', ok:false, error:string, fatal:boolean}

export type WorkerResponse = WorkerProgress | WorkerResult

// What handle_action answers with — `pages` is set only by the PDF compile actions
interface ActionOutcome {
    result:Uint8Array|string|number|null
    pages:number|null
}


// The generator instance, created by the 'init' action (null until then)
let generator:TypstWeb|null = null

// The open design's custom fonts, as last set by 'set_custom_fonts' — restored after a compile
// that brought its own
let design_fonts:CustomFont[] = []

// Actions run one at a time since compiles mutate shared compiler state (fonts, shadow files)
let queue:Promise<void> = Promise.resolve()


// Prepend a rendered cover (its single wraparound page) to a book PDF, for the preview only —
// stored versions keep the cover as its own separate cover.pdf. The page is cropped to its trim
// box (bleed hidden) and gets 50%-gray guide lines on the fold(s). Both are preview aids: the
// content is untouched and the real cover PDF is produced by a different path
async function prepend_cover(
    cover_bytes:Uint8Array, book_bytes:Uint8Array, geometry:CoverPageGeometry|null,
):Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    const cover_doc = await PDFDocument.load(cover_bytes)
    const [cover_page] = await book.copyPages(cover_doc, [0])

    if (geometry){
        const page_h = cover_page!.getHeight()
        // Crop to the trim box (drop the bleed) — a display-only crop, content is preserved
        if (geometry.crop){
            const {left, top, width, height} = geometry.crop
            cover_page!.setCropBox(left, page_h - (top + height), width, height)
        }
        // Gray fold guide lines, clipped by the crop box above to the visible trim height
        const gray = rgb(0.5, 0.5, 0.5)
        for (const x of geometry.fold_x){
            cover_page!.drawLine({
                start: {x, y: 0},
                end: {x, y: page_h},
                thickness: 0.5,
                color: gray,
            })
        }
    }

    book.insertPage(0, cover_page!)
    return book.save()
}


// Whether compiling `request` with custom fonts `a` would use exactly the same fonts as with `b`:
// every custom family the request actually uses is in both or neither, with identical bytes.
// Families the request doesn't use can differ freely, so a version's own (referenced-only) set
// matches the open design's full set whenever it's that design's version, unchanged
function fonts_equivalent(request:TypstRequest, a:CustomFont[], b:CustomFont[]):boolean {
    let used:Set<string>
    try {
        used = new Set(collect_fonts(request))
    } catch {
        // The font manifest isn't loaded yet — can't tell, so treat them as different
        return false
    }
    const used_by_family = (fonts:CustomFont[]) => {
        return new Map(fonts.filter(font => used.has(font.family)).map(font => [font.family, font]))
    }
    const a_used = used_by_family(a)
    const b_used = used_by_family(b)
    if (a_used.size !== b_used.size){
        return false
    }
    for (const [family, font] of a_used){
        const other = b_used.get(family)
        if (!other || other.files.length !== font.files.length
                || font.files.some((file, i) => !same_bytes(file, other.files[i]!))){
            return false
        }
    }
    return true
}


// Whether two byte arrays hold identical contents
function same_bytes(a:Uint8Array, b:Uint8Array):boolean {
    if (a.length !== b.length){
        return false
    }
    for (let i = 0; i < a.length; i++){
        if (a[i] !== b[i]){
            return false
        }
    }
    return true
}


// Perform a single action, returning PDF bytes (or an SVG string, or a page count) plus, for
// the PDF compile actions, the page count of those bytes. Compile actions report progress via
// on_progress, posted back to the main thread as separate WorkerProgress messages (see below)
// ahead of the final result
async function handle_action(
    message:WorkerRequest, on_progress:(event:ProgressEvent) => void,
):Promise<ActionOutcome> {
    if (message.action === 'init'){
        // The compiler WASM comes from the shared assets tree's typst/ dir (vendored per npm
        // version by the bookcover repo), keyed by the installed npm version, so upgrading
        // the package also requires the bookcover repo publishing the new version dir
        const assets = message.assets_prefix.replace(/\/+$/, '')
        const wasm_url = `${assets}/typst/${compiler_version}/typst_ts_web_compiler_bg.wasm`
        // Only compile_svg (the wizard's minimal-ink cover card) needs the renderer, and
        // typst-web only fetches its module once one is actually asked for
        const renderer_wasm_url = `${assets}/typst/${renderer_version}/typst_ts_renderer_bg.wasm`
        generator = await init_typst(
            {wasm_url, renderer_wasm_url, assets_prefix: message.assets_prefix})
        return {result: null, pages: null}
    }

    // The pdf-lib-only actions need no compiler, so they're answered before the init check —
    // adopting an already-uploaded PDF (see adopt_pending_pdf) must not depend on WASM having
    // come up
    if (message.action === 'page_count'){
        return {result: (await PDFDocument.load(message.pdf)).getPageCount(), pages: null}
    }
    if (message.action === 'preview_strip'){
        const bytes = await add_preview_strip(message.pdf, message.page_width, message.title,
            message.subtitle, message.position)
        return {result: bytes, pages: null}
    }
    if (message.action === 'prepend_cover'){
        return {result: await prepend_cover(message.cover, message.book, message.geometry),
            pages: null}
    }

    if (!generator){
        throw new Error('Typst worker used before init')
    }
    if (message.action === 'set_custom_fonts'){
        design_fonts = message.fonts
        generator.set_custom_fonts(design_fonts)
        return {result: null, pages: null}
    }
    if (message.action === 'compile_svg'){
        return {result: await generator.compile_svg(message.request), pages: null}
    }

    // Both PDF compiles report their page count alongside the bytes — every caller wants it and
    // the alternative is shipping pdf-lib to the main thread purely to re-parse what was just
    // compiled here
    if (message.action === 'compile_pdf_preview'){
        const bytes = await generator.compile_pdf_preview(message.request, on_progress)
        return {result: bytes, pages: (await PDFDocument.load(bytes)).getPageCount()}
    }

    // A compile's own fonts are swapped in and back out within this one queued action, so no
    // other request can ever run against them (or swap them away mid-compile). Skipped when the
    // open design's set would resolve the same, since each swap forces a compiler rebuild
    const own_fonts = message.fonts
    const swap = own_fonts !== undefined
        && !fonts_equivalent(message.request, own_fonts, design_fonts)
    if (swap){
        generator.set_custom_fonts(own_fonts)
    }
    try {
        const bytes = await generator.compile_pdf(message.request, on_progress,
            message.preview ?? false)
        return {result: bytes, pages: (await PDFDocument.load(bytes)).getPageCount()}
    } finally {
        if (swap){
            generator.set_custom_fonts(design_fonts)
        }
    }
}


// Queue each incoming message and answer it with a response bearing the same id
self.addEventListener('message', (event:MessageEvent<WorkerRequest>) => {
    queue = queue.then(async () => {
        const id = event.data.id
        try {
            const on_progress = (progress_event:ProgressEvent) => {
                postMessage({id, kind: 'progress', event: progress_event} satisfies WorkerResponse)
            }
            const {result, pages} = await handle_action(event.data, on_progress)
            const response:WorkerResponse = {
                id, kind: 'result', ok: true, result, pages, worn: generator?.worn ?? false}
            postMessage(response)
        } catch (error){
            // Log here too since the Error loses its stack when serialised for the main thread
            console.error(error)
            const error_msg = error instanceof Error ? error.message : String(error)
            const response:WorkerResponse = {id, kind: 'result', ok: false, error: error_msg,
                fatal: error instanceof WebAssembly.RuntimeError}
            postMessage(response)
        }
    })
})
