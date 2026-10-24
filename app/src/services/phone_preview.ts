
// The phone's preview: what a design will look like, shown full screen before it's built. A
// desktop sees this all along in its live preview pane, which a phone has no room for, so its
// editor previews on request instead (see DialogPhonePreview.vue).
//
// The pages are standalone SVGs rather than a PDF, since phones can't show a PDF inside a page,
// and come one per page in reading order (see generate_svg_preview). The window is the same
// ~30 pages a phone's page estimate compiles, from the start of the document, so the estimate
// falls out of the preview for free.

import {truncate_for_preview, ESTIMATE_CHAR_LIMIT, svg_page_markup} from 'paper-bible-typst'

import {blue, page_count_guess} from '@/services/state'
import {bible_content} from '@/services/content'
import {current_design_id} from '@/services/designs'
import {typst_generator} from '@/services/typst'
import {get_custom_font_styles} from '@/services/custom_fonts'
import {resolve_content_for_style} from '@/services/content_images'
import {render_cover_panels} from '@/services/cover'
import {render_signature, set_page_estimate} from '@/services/page_estimate'
import {claim_compile_turn} from '@/services/compile_progress'
import {PREVIEW_TIMEOUT_MS, switch_to_server} from '@/services/compile_mode'

import type {CompileProgress} from '@/services/compile_progress'


// A preview ready to show
export interface PhonePreview {
    // Each page as standalone SVG markup, the front cover first when the design has one
    pages:string[]
    // Whether the document goes on past the pages shown
    truncated:boolean
}


// A preview abandoned for taking longer than PREVIEW_TIMEOUT_MS, after which the device builds
// on the server
export class SlowPreviewError extends Error {}


export async function compile_phone_preview(on_progress:(event:CompileProgress) => void)
        :Promise<PhonePreview>{
    // Compile the open design's preview in this browser. Waits for any build compiling here
    // first, since a phone can't hold two documents' compilers (see claim_compile_turn)
    const generator = typst_generator.value
    const design_id = current_design_id.value
    if (!generator || !design_id){
        throw new Error('Typst compiler not ready')
    }
    const release_turn = await claim_compile_turn()
    try {
        on_progress({stage: 'start'})
        const signature = render_signature()

        // Resolved as for any compile of the design: painted/torn image variants swapped in, and
        // the design's own link for any auto-copyright block (see compile_preview_window)
        const content = await resolve_content_for_style(design_id, blue.content, blue.image_style)
        const request = await bible_content.resolve({...blue, content}, get_custom_font_styles(),
            on_progress, `https://paper.bible/designs/${design_id}`, page_count_guess())
        const truncation = truncate_for_preview(request, 'start', ESTIMATE_CHAR_LIMIT)

        // Only the compile itself is timed: fetching the Bible's text says nothing about whether
        // this device can typeset it
        const pages = await within_timeout(
            generator.compile_svg_preview(truncation.request, on_progress))

        // The window's page count scaled by how much of the document it covered (exact when
        // nothing was cut), rounded to even since bound pages come in twos — the same estimate a
        // desktop's preview gives (see compile_preview_window)
        const scale = truncation.window_chars > 0
            ? truncation.total_chars / truncation.window_chars : 1
        const page_estimate = Math.max(2, Math.round(pages.length * scale / 2) * 2)
        if (render_signature() === signature){
            set_page_estimate(page_estimate, signature)
        }

        // The front cover leads the preview whenever the window starts at the document's start,
        // which this one always does. The book's compiler is freed first, as a phone may not hold
        // the cover's beside it (see render_cover_here)
        const markup = pages.map(page => svg_page_markup(page))
        if (blue.cover){
            on_progress({stage: 'cover'})
            generator.release_memory()
            markup.unshift((await render_cover_panels(blue, page_estimate)).front)
        }
        return {pages: markup, truncated: truncation.dropped_after}
    } finally {
        release_turn()
    }
}


async function within_timeout<T>(compile:Promise<T>):Promise<T>{
    // Await a browser compile, abandoning it (and switching the device to the server for good)
    // if it takes longer than PREVIEW_TIMEOUT_MS
    let timer:ReturnType<typeof setTimeout>|undefined
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            typst_generator.value?.abandon()
            switch_to_server('slow')
            reject(new SlowPreviewError('Preview took too long in the browser'))
        }, PREVIEW_TIMEOUT_MS)
    })
    try {
        return await Promise.race([compile, timeout])
    } finally {
        clearTimeout(timer)
    }
}
