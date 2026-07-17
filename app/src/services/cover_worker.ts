
// Web Worker that owns the bookcover WASM compiler (a second, independent Typst instance from
// the book's own typst_worker), so cover renders never block the UI or share compiler state
// with book compiles. Driven by the CoverWorkerClient in cover.ts via id-tagged messages.

import {version as compiler_version} from '@myriaddreamin/typst-ts-web-compiler/package.json'
import {init as init_bookcover, build_schema} from 'bookcover-web'

import type {CoverGenerator, EmbedFormState} from 'bookcover-web'
import type {CustomFont} from 'typst-fonts'


// Actions the main thread can request (see CoverWorkerClient in cover.ts). Fonts are kept in
// worker state (not sent per generate) so their byte-array identities stay stable, which is
// what bookcover-web keys its compiler font cache on
export type CoverWorkerAction =
    | {action:'init', assets_prefix:string}
    | {action:'set_custom_fonts', fonts:CustomFont[]}
    | {action:'generate', form:Record<string, unknown>, image:{data:Uint8Array, type:string}|null}

// A generate always also asks bookcover to split the full wraparound PDF into its individual
// panels (a cheap CropBox post-process, not a second compile) — the front/back panels are what
// the "Reading" preview shows, ignoring the spine, since a reader never sees the spine as a page
export interface CoverRenderResult {
    data:Uint8Array
    front:Uint8Array
    back:Uint8Array
}

// Every request carries an id, echoed back in the matching response
export type CoverWorkerRequest = CoverWorkerAction & {id:number}

// Final response to a request: render result for generate, null for init/set_custom_fonts
export type CoverWorkerResponse =
    | {id:number, ok:true, result:CoverRenderResult|null}
    | {id:number, ok:false, error:string}


// The generator instance, created by the 'init' action (null until then)
let generator:CoverGenerator|null = null

// User-uploaded fonts the current design's cover references (set via 'set_custom_fonts')
let custom_fonts:CustomFont[] = []

// Actions run one at a time since generates mutate shared compiler state (fonts, shadow files)
let queue:Promise<void> = Promise.resolve()


// Perform a single action, returning a render result for generate actions
async function handle_action(message:CoverWorkerRequest):Promise<CoverRenderResult|null> {
    if (message.action === 'init'){
        // Everything comes from the one shared assets tree: the compiler WASM under typst/
        // (keyed by the installed npm version), bookcover's Typst templates/frames under
        // docs/ and frames/, and the fonts collection under fonts/
        const assets = message.assets_prefix.replace(/\/+$/, '')
        const wasm_url = `${assets}/typst/${compiler_version}/typst_ts_web_compiler_bg.wasm`
        generator = await init_bookcover({
            wasm_url,
            assets_prefix: message.assets_prefix,
            fonts_prefix: `${assets}/fonts`,
        })
        return null
    }
    if (!generator){
        throw new Error('Cover worker used before init')
    }
    if (message.action === 'set_custom_fonts'){
        custom_fonts = message.fonts
        return null
    }
    // Derive the renderable schema from the (size-overlaid) form, then generate the PDF —
    // build_schema needs each custom font's sniffed style to pick correct Noto fallbacks
    const schema = build_schema(message.form as unknown as EmbedFormState,
        custom_fonts.map(font => ({family: font.family, style: font.style})))
    const image = message.image
        ? new Blob([message.image.data as unknown as BlobPart], {type: message.image.type})
        : undefined
    const result = await generator.generate({schema, image, format: 'pdf', split: true,
        custom_fonts: custom_fonts.flatMap(font => font.files)})
    const split = result.split as {front:Uint8Array, back:Uint8Array}
    return {data: result.data as Uint8Array, front: split.front, back: split.back}
}


// Queue each incoming message and answer it with a response bearing the same id
self.addEventListener('message', (event:MessageEvent<CoverWorkerRequest>) => {
    queue = queue.then(async () => {
        const id = event.data.id
        try {
            const result = await handle_action(event.data)
            postMessage({id, ok: true, result} satisfies CoverWorkerResponse)
        } catch (error){
            // Log here too since the Error loses its stack when serialised for the main thread
            console.error(error)
            const error_msg = error instanceof Error ? error.message : String(error)
            postMessage({id, ok: false, error: error_msg} satisfies CoverWorkerResponse)
        }
    })
})
