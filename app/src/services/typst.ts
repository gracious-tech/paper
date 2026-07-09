
import {shallowRef, toRaw} from 'vue'

import type {CustomFont} from 'typst-fonts'
import type {TypstRequest} from 'paper-bible-typst'
import type {WorkerAction, WorkerResponse} from './typst_worker'


// Handlers awaiting a response from the worker, keyed by request id
interface PendingHandlers {
    resolve:(result:Uint8Array|null)=>void
    reject:(error:Error)=>void
}


// Client for the Typst Web Worker: same async API as typst-web's TypstWeb class, but every call
// is relayed to the worker (see typst_worker.ts) so WASM compilation never blocks the UI thread
export class TypstWorkerClient {

    private worker:Worker
    private next_id = 0
    private pending = new Map<number, PendingHandlers>()

    constructor(){
        this.worker = new Worker(new URL('./typst_worker.ts', import.meta.url), {type: 'module'})

        // Resolve/reject the matching call for each response
        this.worker.onmessage = (event:MessageEvent<WorkerResponse>) => {
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

    // Send one request to the worker and await its matching response
    private send(action:WorkerAction):Promise<Uint8Array|null> {
        const id = this.next_id++
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject})
            this.worker.postMessage({...action, id})
        })
    }

    // Initialise the WASM compiler in the worker (base fonts only — fonts are (re)loaded per
    // compile based on what each request needs)
    async init(assets_prefix:string):Promise<void> {
        await this.send({action: 'init', assets_prefix})
    }

    // Send the current set of user-uploaded fonts to the worker. Unlike the in-thread generator
    // this replaced, the worker gets a copy of the array, so re-call this after every upload
    async set_custom_fonts(fonts:CustomFont[]):Promise<void> {
        // toRaw since Vue reactive proxies can't be structured-cloned across the worker boundary
        await this.send({action: 'set_custom_fonts', fonts: toRaw(fonts)})
    }

    // Compile a request to a finished PDF (booklet/alternate/half-blank handled in the worker)
    async compile_pdf(request:TypstRequest):Promise<Uint8Array> {
        return await this.send({action: 'compile_pdf', request}) as Uint8Array
    }

    // Compile a request to a preview PDF laid out as facing-page book spreads, as if the book
    // were opened: a blank left page beside page 1 on the right, then 2|3, 4|5, etc. For
    // on-screen preview only.
    async compile_pdf_preview(request:TypstRequest):Promise<Uint8Array> {
        return await this.send({action: 'compile_pdf_preview', request}) as Uint8Array
    }
}


// In-browser Typst PDF generator (worker client) — set once the worker's WASM compiler has
// initialised. shallowRef so Vue tracks assignment without deeply proxying the client instance.
export const typst_generator = shallowRef<TypstWorkerClient|null>(null)
