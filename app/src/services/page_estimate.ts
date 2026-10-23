
import {watch, onUnmounted} from 'vue'
import {debounce} from 'lodash-es'
import {truncate_for_preview, ESTIMATE_CHAR_LIMIT} from 'paper-bible-typst'

import {blue, estimated_pages, page_count_guess} from '@/services/state'
import {content, bible_content} from '@/services/content'
import {collect_passage_books, has_missing_books} from '@/services/blueprints'
import {current_design_id} from '@/services/designs'
import {typst_generator} from '@/services/typst'
import {get_custom_font_styles} from '@/services/custom_fonts'
import {resolve_content_for_style} from '@/services/content_images'
import {report_error} from '@/services/errors'
import {use_is_mobile} from '@/services/display'
import {compiling_here} from '@/services/compile_progress'

import type {PreviewSection, PreviewTruncation, ProgressFn} from 'paper-bible-typst'
import type {TypstWorkerClient} from '@/services/typst'


// The page-count estimate (`estimated_pages`) comes from compiling a preview-sized window of the
// open design. On desktop the live preview (DisplayPreview.vue) refreshes it as a side effect of
// every compile. Mobile has no preview pane, so nothing compiles in the background there:
// whatever needs the estimate asks for it on demand (ensure_page_estimate), and it's computed
// then, from a smaller window (ESTIMATE_CHAR_LIMIT) whose PDF is never displayed


// What a preview-window compile produced
export interface PreviewWindow {
    bytes:Uint8Array
    truncation:PreviewTruncation
    // Whether the window reaches the start of the document and the design has a cover, so the
    // preview shows one in front of it
    show_front_cover:boolean
    share_url:string|undefined
    page_estimate:number
    // The render_signature() the compile started from
    signature:string
}


// The render_signature() the current estimate was computed from
let estimated_for:string|null = null

// The on-demand estimate currently compiling, if any, so concurrent callers share it
let pending:{signature:string, promise:Promise<void>}|null = null


export function render_signature():string{
    // Everything in the blueprint a compile actually renders from. `name` is deliberately left
    // out: it reaches the PDF as metadata only, so renaming the design must never cost a
    // recompile. The cover's own title *is* visible, and stays part of blue.cover
    const {name: _name, ...rest} = blue
    return JSON.stringify(rest)
}


export async function compile_preview_window(generator:TypstWorkerClient, section:PreviewSection,
        limit:number, on_progress?:ProgressFn, cover_label?:string):Promise<PreviewWindow>{
    // Compile a window of the open design of at most `limit` characters (PREVIEW_CHAR_LIMIT for
    // the preview, ESTIMATE_CHAR_LIMIT when only the page count is wanted), and estimate the full
    // page count from it. `cover_label` marks the gray inside-of-cover slot when a cover precedes it
    const signature = render_signature()

    // Swap in painted/torn variants of any images before resolving (a no-op for the plain
    // styles) — see content_images.ts for why this can't just happen inside resolve() itself.
    // Styled variants are cached under the design, so this only applies once one is open
    // (the very first boot preview can run before that, and needs no masking anyway)
    const styled_content = current_design_id.value
        ? await resolve_content_for_style(current_design_id.value, blue.content,
            blue.image_style)
        : blue.content

    // The design's production URL, for the "customise this design" link + QR code in any
    // auto-copyright block (a created version uses its own version URL instead — see
    // versions.ts). Hardcoded to the real domain (not location.origin) so a dev/preview
    // compile still bakes a working link/QR into the document — mirrors version_compile.ts.
    // Omitted if no design is open yet
    const share_url = current_design_id.value
        ? `https://paper.bible/designs/${current_design_id.value}`
        : undefined

    // The preview lays the pages out as facing-page book spreads, as if the book were opened
    const request = await bible_content.resolve(
        {...blue, content: styled_content}, get_custom_font_styles(), on_progress, share_url,
        page_count_guess())

    // Large documents are trimmed to a fast-compiling window (positioned by `section`) — whole
    // books are dropped and only the last kept book's tail is ever cut, never a book's start, so
    // kept pages lay out exactly as in the real document
    const truncation = truncate_for_preview(request, section, limit)

    // The front cover is only shown when the preview window reaches the start of the
    // document — a Middle or End window drops it
    const show_front_cover = !!blue.cover && !truncation.dropped_before
    if (show_front_cover && cover_label){
        truncation.request.preview_cover_label = cover_label
    }

    // The worker returns the spread count alongside the bytes, so a multi-megabyte PDF is
    // never re-parsed on this thread just to be measured
    const {bytes, pages} = await generator.compile_pdf_preview(truncation.request, on_progress)

    // The window's own page count scaled by how much of the document it covered (exact when
    // nothing was truncated). Reading spreads hold two book pages per PDF page, and the result
    // is rounded to an even number since bound pages always come in twos
    const window_pages = Math.max(1, pages * 2)
    const scale = truncation.window_chars > 0
        ? truncation.total_chars / truncation.window_chars
        : 1
    const page_estimate = Math.max(2, Math.round(window_pages * scale / 2) * 2)

    return {bytes, truncation, show_front_cover, share_url, page_estimate, signature}
}


export function set_page_estimate(pages:number, signature:string):void{
    // Record a fresh estimate along with the blueprint state it was computed from
    estimated_pages.value = pages
    estimated_for = signature
}


export function ensure_page_estimate():Promise<void>{
    // Make sure the estimate reflects the open design as it is now, compiling a window if not.
    // A no-op wherever the live preview already keeps it current. Never throws: a failed
    // estimate is reported and leaves the previous one (or the fallback guess) in place, since
    // nothing that asks for one should fail over it
    const generator = typst_generator.value
    if (!generator || has_missing_books(collect_passage_books(blue.content), blue.bibles)){
        return Promise.resolve()
    }
    const signature = render_signature()
    if (estimated_pages.value !== null && estimated_for === signature){
        return Promise.resolve()
    }
    if (pending?.signature === signature){
        return pending.promise
    }

    const promise = (async () => {
        try {
            const result = await compile_preview_window(generator, 'start', ESTIMATE_CHAR_LIMIT)
            // Only kept if the design wasn't edited or switched while compiling — an estimate of
            // something else would pass the freshness check above for the wrong content
            if (render_signature() === result.signature){
                set_page_estimate(result.page_estimate, result.signature)
            }
        } catch (error){
            report_error('silent', error, {context: {stage: 'page_estimate'}})
        } finally {
            if (pending?.signature === signature){
                pending = null
            }
        }
    })()
    pending = {signature, promise}
    return promise
}


export function use_page_estimate_while_mounted():void{
    // Keep the estimate current while the calling component is on screen, for panels that show
    // something derived from it. Only needed on mobile, where no preview is doing so already.
    // Waits while a build compiles in this tab, since a phone can't hold both (see
    // claim_compile_turn), and catches up once it's done.
    // Must be called from a component's setup()
    const is_mobile = use_is_mobile()
    const refresh = debounce(() => {
        if (is_mobile.value && !compiling_here.value){
            void ensure_page_estimate()
        }
    }, 1000)
    watch([render_signature, () => typst_generator.value, () => content.loaded, is_mobile,
        compiling_here], refresh, {immediate: true, deep: true})
    onUnmounted(() => {
        refresh.cancel()
    })
}

