
// Web Worker that owns the WASM Typst compiler, so PDF compilation (which can take seconds for
// large documents) runs off the main thread and never lags the UI. Driven by TypstWorkerClient
// in typst.ts via simple id-tagged request/response messages.

import wasm_url from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import {init as init_typst} from 'paper-bible-typst-web'

import type {TypstWeb} from 'paper-bible-typst-web'
import type {CustomFont} from 'typst-fonts'
import type {TypstRequest} from 'paper-bible-typst'


// Actions the main thread can request (see TypstWorkerClient in typst.ts)
export type WorkerAction =
    | {action:'init', assets_prefix:string}
    | {action:'set_custom_fonts', fonts:CustomFont[]}
    | {action:'compile_pdf', request:TypstRequest}
    | {action:'compile_pdf_preview', request:TypstRequest}

// Every request carries an id, echoed back in the matching response
export type WorkerRequest = WorkerAction & {id:number}

// Response to a request: PDF bytes for compile actions, null for init/set_custom_fonts
export type WorkerResponse =
    | {id:number, ok:true, result:Uint8Array|null}
    | {id:number, ok:false, error:string}


// The generator instance, created by the 'init' action (null until then)
let generator:TypstWeb|null = null

// Actions run one at a time since compiles mutate shared compiler state (fonts, shadow files)
let queue:Promise<void> = Promise.resolve()


// Perform a single action, returning PDF bytes for compile actions
async function handle_action(message:WorkerRequest):Promise<Uint8Array|null> {
    if (message.action === 'init'){
        generator = await init_typst({wasm_url, assets_prefix: message.assets_prefix})
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
        return generator.compile_pdf(message.request)
    }
    return generator.compile_pdf_preview(message.request)
}


// Queue each incoming message and answer it with a response bearing the same id
self.addEventListener('message', (event:MessageEvent<WorkerRequest>) => {
    queue = queue.then(async () => {
        try {
            const result = await handle_action(event.data)
            postMessage({id: event.data.id, ok: true, result} satisfies WorkerResponse)
        } catch (error){
            // Log here too since the Error loses its stack when serialised for the main thread
            console.error(error)
            const error_msg = error instanceof Error ? error.message : String(error)
            postMessage({id: event.data.id, ok: false, error: error_msg} satisfies WorkerResponse)
        }
    })
})
