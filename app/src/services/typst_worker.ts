
// Web Worker that owns the WASM Typst compiler, so PDF compilation (which can take seconds for
// large documents) runs off the main thread and never lags the UI. Driven by TypstWorkerClient
// in typst.ts via simple id-tagged request/response messages.

import {version as compiler_version} from '@myriaddreamin/typst-ts-web-compiler/package.json'
import {version as renderer_version} from '@myriaddreamin/typst-ts-renderer/package.json'
import {init as init_typst} from 'paper-bible-typst-web'

import type {TypstWeb} from 'paper-bible-typst-web'
import type {CustomFont} from 'typst-fonts'
import type {TypstRequest, ProgressEvent} from 'paper-bible-typst'


// Actions the main thread can request (see TypstWorkerClient in typst.ts)
export type WorkerAction =
    | {action:'init', assets_prefix:string}
    | {action:'set_custom_fonts', fonts:CustomFont[]}
    | {action:'compile_pdf', request:TypstRequest, preview?:boolean}
    | {action:'compile_pdf_preview', request:TypstRequest}
    | {action:'compile_svg', request:TypstRequest}

// Every request carries an id, echoed back in the matching response
export type WorkerRequest = WorkerAction & {id:number}

// A coarse progress update for an in-flight compile, keyed by the same id as its request. Any
// number of these may arrive before the matching WorkerResult
export type WorkerProgress = {id:number, kind:'progress', event:ProgressEvent}

// Final response to a request: PDF bytes for the PDF compile actions, an SVG string for
// compile_svg, null for init/set_custom_fonts.
// worn = the WASM compiler has permanently accumulated enough memory that this whole worker
// should be recycled (see TypstWeb.worn). fatal = the error was a WASM trap (e.g. an
// out-of-memory abort), which poisons the compiler for good — the worker must be recycled
// before any further compile can succeed. Both are acted on by TypstWorkerClient in typst.ts.
export type WorkerResult =
    | {id:number, kind:'result', ok:true, result:Uint8Array|string|null, worn:boolean}
    | {id:number, kind:'result', ok:false, error:string, fatal:boolean}

export type WorkerResponse = WorkerProgress | WorkerResult


// The generator instance, created by the 'init' action (null until then)
let generator:TypstWeb|null = null

// Actions run one at a time since compiles mutate shared compiler state (fonts, shadow files)
let queue:Promise<void> = Promise.resolve()


// Perform a single action, returning PDF bytes (or an SVG string) for compile actions. Compile
// actions report progress via on_progress, posted back to the main thread as separate
// WorkerProgress messages (see below) ahead of the final result
async function handle_action(
    message:WorkerRequest, on_progress:(event:ProgressEvent) => void,
):Promise<Uint8Array|string|null> {
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
        return null
    }
    if (!generator){
        throw new Error('Typst worker used before init')
    }
    if (message.action === 'set_custom_fonts'){
        generator.set_custom_fonts(message.fonts)
        return null
    }
    if (message.action === 'compile_pdf'){
        return generator.compile_pdf(message.request, on_progress, message.preview ?? false)
    }
    if (message.action === 'compile_svg'){
        return generator.compile_svg(message.request)
    }
    return generator.compile_pdf_preview(message.request, on_progress)
}


// Queue each incoming message and answer it with a response bearing the same id
self.addEventListener('message', (event:MessageEvent<WorkerRequest>) => {
    queue = queue.then(async () => {
        const id = event.data.id
        try {
            const on_progress = (progress_event:ProgressEvent) => {
                postMessage({id, kind: 'progress', event: progress_event} satisfies WorkerResponse)
            }
            const result = await handle_action(event.data, on_progress)
            const response:WorkerResponse = {
                id, kind: 'result', ok: true, result, worn: generator?.worn ?? false}
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
