
// Previews made on the server, for a device that compiles there (see compile_mode.ts), or whose
// browser couldn't make this one. The server reads the design from Firestore rather than being
// sent it, so unsaved edits are flushed first, and the painted/torn image variants it can't make
// itself (masking needs a canvas) are made here and uploaded beforehand.
//
// The request is only accepted by /api/preview, since a preview can take longer than any request
// is held open for. The outcome arrives on a previews/{id} doc, and the output itself is a file
// in the design's cache prefix: the same pages and cover the browser makes (see preview.ts), as
// JSON.

import {doc, onSnapshot} from 'firebase/firestore'
import {ref as storage_ref, getBytes} from 'firebase/storage'

import {blue, page_count_guess} from '@/services/state'
import {firestore, firebase_storage} from '@/services/firebase'
import {api, ApiOfflineError} from '@/services/api'
import {current_design_id, flush_changes} from '@/services/designs'
import {resolve_content_for_style} from '@/services/content_images'
import {is_masked_image_style} from '@/services/image_frame'
import {render_signature, set_page_estimate, fresh_estimate} from '@/services/page_estimate'
import {retry_network} from '@/services/network_retry'
import {settle_server_mode} from '@/services/compile_mode'
import {report_error} from '@/services/errors'

import type {PreviewPages, PreviewSection, PreviewSize} from 'paper-bible-typst'
import type {CompileProgress} from '@/services/compile_progress'
import type {Preview} from '@/services/preview'


// How long to wait for the server to make a preview before giving up on it. A preview is only a
// window of the document, so this is generous, but something has to give up: a job lost from the
// compile function's queue never settles its doc at all
export const SERVER_PREVIEW_TIMEOUT_MS = 3 * 60 * 1000


// The server made the preview and failed (its error report's id, for support), or never made it
export class ServerPreviewError extends Error {
    error_id:string|null

    constructor(message:string, error_id:string|null = null){
        super(message)
        this.error_id = error_id
    }
}


// The fields of a previews/{id} doc the client reads
interface PreviewDoc {
    status:'pending'|'available'|'failed'
    path:string|null
    page_estimate:number|null
    truncated:boolean|null
    dropped_before:boolean|null
    dropped_after:boolean|null
    error_id:string|null
}


export async function request_server_preview(size:PreviewSize, section:PreviewSection,
        on_progress?:(event:CompileProgress) => void):Promise<Preview>{
    // Have the server preview the open design as it is now (a phone's window, or the desktop's
    // `section`), and wait for the result. The page estimate it brings is kept if the design
    // hasn't changed meanwhile, and its outcome settles a provisional switch to the server (see
    // settle_server_mode)
    const design_id = current_design_id.value
    if (!design_id){
        throw new Error('No design open to preview')
    }
    on_progress?.({stage: 'server'})
    const signature = render_signature()

    // The server reads the design from Firestore, and can't mask images itself
    await flush_changes()
    if (is_masked_image_style(blue.image_style)){
        await resolve_content_for_style(design_id, blue.content, blue.image_style)
    }

    // Accepted straight away, or refused (an ApiError) — a lost connection is waited out, since
    // there's nothing here to try again but this
    const body = {design_id, page_count: page_count_guess(), size, section}
    const {preview_id} = await retry_network(
        () => api<{preview_id:string}>('/api/preview', body),
        error => error instanceof ApiOfflineError, `preview_${design_id}`)

    const result = await await_preview(preview_id)
    settle_server_mode(result.status === 'available')
    if (result.status !== 'available' || !result.path){
        throw new ServerPreviewError('The server failed to make the preview', result.error_id)
    }
    const bytes = await gunzip_if_needed(
        new Uint8Array(await getBytes(storage_ref(firebase_storage, result.path))))
    if (render_signature() === signature && result.page_estimate !== null){
        set_page_estimate(result.page_estimate, signature)
    }
    const {pages, covers} = JSON.parse(new TextDecoder().decode(bytes)) as PreviewPages
    return {pages, covers, truncated: !!result.truncated,
        dropped_before: !!result.dropped_before, dropped_after: !!result.dropped_after}
}


function await_preview(preview_id:string):Promise<PreviewDoc>{
    // The preview's doc once the server has settled it, or a ServerPreviewError if that takes
    // longer than SERVER_PREVIEW_TIMEOUT_MS (a job lost from the queue never settles at all)
    return new Promise((resolve, reject) => {
        // Stop listening, and stop the clock, once there's an answer either way
        let unsubscribe = () => {}
        const finish = (settle:() => void) => {
            clearTimeout(timer)
            unsubscribe()
            settle()
        }
        const timer = setTimeout(() => {
            finish(() => reject(new ServerPreviewError('The server took too long to preview')))
        }, SERVER_PREVIEW_TIMEOUT_MS)
        unsubscribe = onSnapshot(doc(firestore, 'previews', preview_id), snapshot => {
            const data = snapshot.data() as PreviewDoc|undefined
            if (data && data.status !== 'pending'){
                finish(() => resolve(data))
            }
        }, error => {
            finish(() => reject(error))
        })
    })
}


async function gunzip_if_needed(bytes:Uint8Array):Promise<Uint8Array>{
    // A preview's file as written, whether or not its gzip was already undone on the way. It's
    // stored gzipped with a Content-Encoding the browser normally undoes itself, but whatever
    // serves it might not pass that on (an emulator, a proxy), and JSON can't start with gzip's
    // magic number, so it's told apart by that
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b){
        return bytes
    }
    const stream = new Blob([bytes as BlobPart]).stream()
        .pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}


// The server estimate being made for a render_signature(), so concurrent callers share it
let estimating:{signature:string, promise:Promise<void>}|null = null


export function ensure_server_estimate(max_wait_ms:number):Promise<void>{
    // Make sure the page estimate reflects the open design on a device that compiles on the
    // server, where estimates otherwise only come from previews and builds: if it's stale, the
    // server makes a phone's preview whose pages go unused. Waits at most `max_wait_ms` (the
    // estimate still lands once it arrives), and never throws, like ensure_page_estimate
    if (fresh_estimate(blue) !== null || !current_design_id.value){
        return Promise.resolve()
    }
    const signature = render_signature()
    if (estimating?.signature !== signature){
        const promise = (async () => {
            try {
                await request_server_preview('phone', 'start')
            } catch (error){
                if (!(error instanceof ServerPreviewError && error.error_id)){
                    report_error('silent', error, {context: {stage: 'server_estimate'}})
                }
            } finally {
                if (estimating?.signature === signature){
                    estimating = null
                }
            }
        })()
        estimating = {signature, promise}
    }
    return Promise.race([estimating.promise,
        new Promise<void>(resolve => setTimeout(resolve, max_wait_ms))])
}
