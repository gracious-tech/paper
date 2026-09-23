
// Web Worker that owns the bookcover WASM compiler (a second, independent Typst instance from
// the book's own typst_worker), so cover renders never block the UI or share compiler state
// with book compiles. Driven by the CoverWorkerClient in cover.ts via id-tagged messages.

import {version as compiler_version} from '@myriaddreamin/typst-ts-web-compiler/package.json'
import {version as renderer_version} from '@myriaddreamin/typst-ts-renderer/package.json'
import {init as init_bookcover, build_schema} from 'bookcover-web'
import {replace_copyright_marker} from 'paper-bible-typst'

import type {CoverGenerator, EmbedFormState} from 'bookcover-web'
import type {CustomFont} from 'typst-fonts'


// Actions the main thread can request (see CoverWorkerClient in cover.ts). Fonts are kept in
// worker state (not sent per generate) so their byte-array identities stay stable, which is
// what bookcover-web keys its compiler font cache on. `image_builtin`, when set, is the builtin
// background's id — bookcover then takes the auto colours from its baked table by that id,
// whichever copy of the image is being rendered, instead of decoding the pixels.
// `image_max_dpi`, when set, has bookcover shrink the image before compiling (previews only).
// `image.key` is a stable identity for the bytes (builtin id or upload hash, plus which copy):
// bookcover recognises a repeat image across messages by a File's name + modified time, which
// is what lets a run of preview renders reuse its one downscaled copy instead of redoing it.
// `copyright_block`, when set, is pre-built Typst markup that replaces the AUTO-COPYRIGHT marker
// in the rendered blurb (the default cover seeds that marker into its rear text — see
// default_cover_preset in cover.ts)
export type CoverWorkerAction =
    | {action:'init', assets_prefix:string}
    | {action:'set_custom_fonts', fonts:CustomFont[]}
    | {action:'generate', form:Record<string, unknown>,
        image:{data:Uint8Array, type:string, key:string}|null, image_builtin?:string,
        image_max_dpi?:number, copyright_block?:string, format?:'pdf'|'svg'}

// A generate always also asks bookcover to split the full wraparound render into its individual
// panels (a cheap post-process, not a second compile) — the front/back panels are what the
// "Reading" preview (and the wizard's front-only previews) show, ignoring the spine, since a
// reader never sees the spine as a page. `data`/`front`/`back` are strings for `format:'svg'`
// (bookcover-web renders SVG as text), Uint8Array bytes for `format:'pdf'` (the default)
export interface CoverRenderResult {
    data:Uint8Array|string
    front:Uint8Array|string
    back:Uint8Array|string
}

// Every request carries an id, echoed back in the matching response
export type CoverWorkerRequest = CoverWorkerAction & {id:number}

// Plain `Omit` collapses a discriminated union to its common keys only (dropping the
// action-specific fields) — this distributes it over each union member instead
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

// Final response to a request: render result for generate, null for init/set_custom_fonts.
// `stack`, when present, is the original throw site inside the worker (see the catch handler
// below) — without it, the main thread can only construct a fresh Error whose stack points at
// the postMessage relay, not the real cause
export type CoverWorkerResponse =
    | {id:number, ok:true, result:CoverRenderResult|null}
    | {id:number, ok:false, error:string, stack?:string}


// The generator instance, created by the 'init' action (null until then)
let generator:CoverGenerator|null = null

// User-uploaded fonts the current design's cover references (set via 'set_custom_fonts')
let custom_fonts:CustomFont[] = []

// Actions run one at a time since generates mutate shared compiler state (fonts, shadow files)
let queue:Promise<void> = Promise.resolve()


// Perform a single action, returning a render result for generate actions, null for
// init/set_custom_fonts
async function handle_action(message:CoverWorkerRequest):Promise<CoverRenderResult|null> {
    if (message.action === 'init'){
        // Everything comes from the one shared assets tree: the compiler WASM under typst/
        // (keyed by the installed npm version), bookcover's Typst templates/frames under
        // docs/ and frames/, and the fonts collection under fonts/
        const assets = message.assets_prefix.replace(/\/+$/, '')
        const wasm_url = `${assets}/typst/${compiler_version}/typst_ts_web_compiler_bg.wasm`
        // The renderer WASM is only needed for svg/png output (the wizard's live preview
        // cards) — small next to the compiler, so always loading it costs little either way
        const renderer_wasm_url = `${assets}/typst/${renderer_version}/typst_ts_renderer_bg.wasm`
        generator = await init_bookcover({
            wasm_url,
            renderer_wasm_url,
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
    // Derive the renderable schema from the (size-overlaid) form, then generate —
    // build_schema needs each custom font's sniffed style to pick correct Noto fallbacks
    const schema = build_schema(message.form as unknown as EmbedFormState,
        custom_fonts.map(font => ({family: font.family, style: font.style})))
    // Splice the generated copyright block into the blurb wherever the AUTO-COPYRIGHT marker
    // sits — build_schema has already rendered the blurb ProseMirror doc to Typst markup, so
    // this mirrors bible_content's interior handling (cover.ts builds the block)
    const blurb = schema['blurb']
    if (message.copyright_block !== undefined && typeof blurb === 'string'){
        schema['blurb'] = replace_copyright_marker(blurb, message.copyright_block)
    }
    // A File named by the stable key with a fixed modified time, so the same bytes posted again
    // are recognised as the same image (see image.key above)
    const image = message.image
        ? new File([message.image.data as unknown as BlobPart], message.image.key,
            {type: message.image.type, lastModified: 0})
        : undefined
    const format = message.format ?? 'pdf'
    const result = await generator.generate({schema, ...image && {image}, format,
        ...message.image_builtin !== undefined && {image_builtin: message.image_builtin},
        ...message.image_max_dpi !== undefined && {image_max_dpi: message.image_max_dpi},
        split: true, custom_fonts: custom_fonts.flatMap(font => font.files)})
    const split = result.split as {front:Uint8Array|string, back:Uint8Array|string}
    return {data: result.data, front: split.front, back: split.back}
}


// Queue each incoming message and answer it with a response bearing the same id
self.addEventListener('message', (event:MessageEvent<CoverWorkerRequest>) => {
    queue = queue.then(async () => {
        const id = event.data.id
        try {
            const result = await handle_action(event.data)
            postMessage({id, ok: true, result} satisfies CoverWorkerResponse)
        } catch (error){
            // Log here too as a fallback, and because DevTools shows a live stack better than
            // any string ever could
            console.error(error)
            const error_msg = error instanceof Error ? error.message : String(error)
            const stack = error instanceof Error ? error.stack : undefined
            postMessage(
                {id, ok: false, error: error_msg, ...stack && {stack}} satisfies CoverWorkerResponse)
        }
    })
})
