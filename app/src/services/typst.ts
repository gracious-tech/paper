
import {shallowRef, toRaw} from 'vue'

import type {CustomFont} from 'typst-fonts'
import type {TypstRequest, ProgressFn} from 'paper-bible-typst'
import type {CoverPageGeometry, WorkerAction, WorkerResponse} from './typst_worker'


// The shared static assets tree (fonts/, typst/ WASM, and bookcover's docs/frames/backgrounds)
// — published to assets.paper.bible by the bookcover repo, whose dev server serves the same
// tree at /generator_assets/ during development
export const ASSETS_PREFIX = import.meta.env.DEV
    ? 'http://localhost:5301/generator_assets/'
    : 'https://assets.paper.bible/'


// What the worker answers a request with: the action's own value, plus the page count of the
// bytes when the action was a PDF compile (see WorkerResult in typst_worker.ts)
interface ActionOutcome {
    result:Uint8Array|string|number|null
    pages:number|null
}

// A compiled PDF and how many pages it has — counted in the worker, so no caller needs pdf-lib
export interface CompiledPdf {
    bytes:Uint8Array
    pages:number
}

// Handlers awaiting a response from the worker, keyed by request id. on_progress is undefined
// for actions that never emit progress (init, set_custom_fonts, the pdf-lib actions)
interface PendingHandlers {
    resolve:(outcome:ActionOutcome)=>void
    reject:(error:Error)=>void
    on_progress:ProgressFn|undefined
}


// Failure of a request that also poisoned the worker's WASM compiler (a trap, e.g. an
// out-of-memory abort). The worker is recycled in response, so compile callers retry once on
// the fresh worker (see send_compile)
class FatalWorkerError extends Error {}


// Client for the Typst Web Worker: same async API as typst-web's TypstWeb class, but every call
// is relayed to the worker (see typst_worker.ts) so WASM compilation never blocks the UI thread.
// The worker is treated as disposable: its WASM compiler permanently accumulates memory for
// every unique source it compiles (nothing in-realm can free it) and a trap corrupts it for
// good, so when a result reports the compiler worn (memory budget exceeded) or fatal (trapped)
// the worker is terminated and respawned — the only way to hand WASM memory back to the browser
export class TypstWorkerClient {

    private worker!:Worker
    private next_id = 0
    private pending = new Map<number, PendingHandlers>()
    // Arguments of the last init/set_custom_fonts calls, replayed into each respawned worker
    private assets_prefix = ''
    private custom_fonts:CustomFont[]|null = null
    // Set when a result reports the worker worn, actioned once no requests are in flight
    private recycle_needed = false
    // Public sends await this before posting, so they never race an in-progress recycle
    private gate:Promise<void> = Promise.resolve()

    constructor(){
        this.spawn_worker()
    }

    // Create the worker and wire up its message handlers (re-run on every recycle)
    private spawn_worker():void {
        this.worker = new Worker(new URL('./typst_worker.ts', import.meta.url), {type: 'module'})

        // Resolve/reject the matching call for each result, or forward progress updates without
        // resolving (any number of these may arrive before the matching result)
        this.worker.onmessage = (event:MessageEvent<WorkerResponse>) => {
            const response = event.data
            const handlers = this.pending.get(response.id)
            if (!handlers){
                return
            }
            if (response.kind === 'progress'){
                handlers.on_progress?.(response.event)
                return
            }
            this.pending.delete(response.id)

            // A fatal failure (WASM trap) poisons the compiler for every queued request too —
            // fail them all now (compile callers retry once, see send_compile) and swap in a
            // fresh worker immediately
            if (!response.ok && response.fatal){
                handlers.reject(new FatalWorkerError(response.error))
                for (const other of this.pending.values()){
                    other.reject(new FatalWorkerError(response.error))
                }
                this.pending.clear()
                this.gate = this.recycle()
                return
            }

            if (response.ok){
                this.recycle_needed ||= response.worn
                handlers.resolve({result: response.result, pages: response.pages})
            } else {
                handlers.reject(new Error(response.error))
            }

            // A worn worker is recycled proactively, between requests so none are lost with it
            if (this.recycle_needed && this.pending.size === 0){
                this.recycle_needed = false
                this.gate = this.recycle()
            }
        }

        // A crash of the worker script itself (rather than a handled compile error) fails all
        // in-flight calls, since no response will ever arrive for them
        this.worker.onerror = event => {
            const error = new Error(event.message || 'Typst worker failed')
            for (const handlers of this.pending.values()){
                handlers.reject(error)
            }
            this.pending.clear()
        }
    }

    // Replace the worn/poisoned worker with a fresh one, replaying init and custom fonts so
    // the swap is invisible to callers
    private async recycle():Promise<void> {
        this.worker.terminate()
        this.spawn_worker()
        // Post both bootstrap messages synchronously so a request already past the gate can't
        // sneak in between them (the worker answers strictly in order)
        const init_done = this.post({action: 'init', assets_prefix: this.assets_prefix})
        const fonts_done = this.custom_fonts
            ? this.post({action: 'set_custom_fonts', fonts: this.custom_fonts})
            : null
        await init_done
        await fonts_done
    }

    // Post one request to the current worker and await its matching result. on_progress, if
    // given, is called for every progress update the worker reports before the result arrives
    private post(action:WorkerAction, on_progress?:ProgressFn):Promise<ActionOutcome> {
        const id = this.next_id++
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject, on_progress})
            this.worker.postMessage({...action, id})
        })
    }

    // As post(), but first waits out any in-progress worker recycle (all public API goes
    // through this)
    private async send(action:WorkerAction, on_progress?:ProgressFn):Promise<ActionOutcome> {
        await this.gate
        return this.post(action, on_progress)
    }

    // Send a compile action, retrying once if it poisoned the worker: the failure triggers a
    // recycle (see onmessage above), so when it was caused by accumulated memory rather than
    // by the document itself, the retry succeeds on the fresh worker
    private async send_compile(
        action:WorkerAction, on_progress?:ProgressFn,
    ):Promise<ActionOutcome> {
        try {
            return await this.send(action, on_progress)
        } catch (error){
            if (!(error instanceof FatalWorkerError)){
                throw error
            }
            try {
                return await this.send(action, on_progress)
            } catch (retry_error){
                // A fresh worker failing the same way means the document itself exceeds the
                // 32-bit WASM heap — surface something clearer than the raw trap message
                if (retry_error instanceof FatalWorkerError){
                    throw new Error("Document too large to generate in the browser "
                        + `(${retry_error.message})`)
                }
                throw retry_error
            }
        }
    }

    // Initialise the WASM compiler in the worker (base fonts only — fonts are (re)loaded per
    // compile based on what each request needs)
    async init(assets_prefix:string):Promise<void> {
        this.assets_prefix = assets_prefix
        await this.send({action: 'init', assets_prefix})
    }

    // Send the current set of user-uploaded fonts to the worker. Unlike the in-thread generator
    // this replaced, the worker gets a copy of the array, so re-call this after every upload
    async set_custom_fonts(fonts:CustomFont[]):Promise<void> {
        // toRaw since Vue reactive proxies can't be structured-cloned across the worker boundary
        this.custom_fonts = toRaw(fonts)
        await this.send({action: 'set_custom_fonts', fonts: this.custom_fonts})
    }

    // Compile a request to a finished PDF (booklet/alternate/half-blank handled in the worker),
    // with the page count the worker counted off it.
    // preview relaxes print-only padding (trailing blanks dropped, even page counts only) for
    // on-screen display — never use it for a document that will be printed.
    async compile_pdf(
        request:TypstRequest, on_progress?:ProgressFn, preview = false,
    ):Promise<CompiledPdf> {
        const outcome = await this.send_compile({action: 'compile_pdf', request, preview},
            on_progress)
        return {bytes: outcome.result as Uint8Array, pages: outcome.pages!}
    }

    // Compile a request to a preview PDF laid out as facing-page book spreads, as if the book
    // were opened: a blank left page beside page 1 on the right, then 2|3, 4|5, etc. For
    // on-screen preview only. `pages` counts those spreads, not the book's own pages.
    async compile_pdf_preview(request:TypstRequest, on_progress?:ProgressFn):Promise<CompiledPdf> {
        const outcome = await this.send_compile({action: 'compile_pdf_preview', request},
            on_progress)
        return {bytes: outcome.result as Uint8Array, pages: outcome.pages!}
    }

    // Compile a single-page request straight to an SVG string, for showing a page as an image
    // on screen (the wizard's minimal-ink cover card) — not a printable path, see compile_svg
    // in typst-web
    async compile_svg(request:TypstRequest):Promise<string> {
        return (await this.send_compile({action: 'compile_svg', request})).result as string
    }

    // Count the pages of a PDF this client didn't compile (one already sitting in Storage).
    // Needs no compiler, so it works even if the WASM init failed
    async page_count(pdf:Uint8Array):Promise<number> {
        return (await this.send({action: 'page_count', pdf})).result as number
    }

    // Add a short "this is only a preview" / "end of preview" notice strip to the front or back
    // of a preview PDF. Text is passed in already translated
    async preview_strip(pdf:Uint8Array, page_width:string, title:string, subtitle:string,
            position:'start'|'end'):Promise<Uint8Array> {
        const outcome = await this.send(
            {action: 'preview_strip', pdf, page_width, title, subtitle, position})
        return outcome.result as Uint8Array
    }

    // Merge a rendered wraparound cover in as page 1 of a preview PDF, cropped and fold-marked
    // per the given geometry (see cover_page_geometry in cover.ts)
    async prepend_cover(cover:Uint8Array, book:Uint8Array, geometry:CoverPageGeometry|null)
            :Promise<Uint8Array> {
        return (await this.send({action: 'prepend_cover', cover, book, geometry}))
            .result as Uint8Array
    }
}


// In-browser Typst PDF generator (worker client) — set once the worker's WASM compiler has
// initialised. shallowRef so Vue tracks assignment without deeply proxying the client instance.
export const typst_generator = shallowRef<TypstWorkerClient|null>(null)
