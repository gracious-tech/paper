
import {gen_preamble} from './preamble.js'
import {gen_passage, gen_passage_facing, passage_columns} from './content_passage.js'
import {gen_title} from './content_title.js'
import {gen_custom} from './content_custom.js'
import {gen_lines} from './content_lines.js'
import {gen_picture_story} from './content_picture_story.js'

import type {TypstRequest, TypstContentItem, TypstPassage} from './types.js'


// Generate a single Typst document string from a request
// This is the "inner" function — produces a compilable .typ file
// For features that need multi-document compilation (alternate interleaving, half-blank),
// use generate_pdf() instead which handles the full pipeline
// start_page offsets the built-in page counter so numbering stays continuous when a book is
// assembled from several separately-compiled documents (see compile_group in pdf_postprocess.ts)
export function generate_typst(request:TypstRequest, start_page = 1):string {
    const parts:string[] = []

    // Must precede any page content to take effect on this document's first page
    if (start_page > 1) {
        parts.push(`#counter(page).update(${start_page})`)
    }

    // Document preamble (page, fonts, paragraph, footer)
    parts.push(gen_preamble(request))

    // Render each content item on its own page(s)
    for (let i = 0; i < request.content.length; i++) {
        const item = request.content[i]!

        if (i > 0) {
            parts.push('#pagebreak()')
        }

        // Set the item's column count on the page itself (a set page rule on the fresh empty
        // page reconfigures it without inserting another break)
        parts.push(gen_page_columns(item))

        parts.push(gen_content_item(item, request))
    }

    return parts.join('\n\n')
}


// Emit the page-level column setting for an item. Columns live on the page rather than in a
// #columns block so each page is its own layout region — footnotes inside a book-length
// #columns block forced Typst to re-lay the whole book per footnote (gigabytes of memory for
// footnote-heavy 2-column books), while page-sized regions keep the same layout cheap.
function gen_page_columns(item:TypstContentItem):string {
    if (item.type === 'passage' && passage_columns(item) === 2) {
        return `#set columns(gutter: ${item.column_gap})\n#set page(columns: 2)`
    }
    return '#set page(columns: 1)'
}


// Whether a passage renders as facing pages (the 'alternate' layout: translations end up on
// alternating pages, each pair reading as one open spread). Such passages compile as their
// own double-width document that post-processing splits down the centre — see process_facing
// in pdf_postprocess.ts — so nothing can merge into or out of them.
export function passage_is_alternate(item:TypstContentItem):boolean {
    return item.type === 'passage' && item.bibles.length > 1 && item.multi_layout === 'alternate'
}


// Generate the double-width document for a facing-pages passage. Every double page is one
// full spread (verso | recto): outer margins sit on both outside edges and the two inner
// margins meet at the centre cut (the grid gutter), so no margin mirroring is needed and each
// half ends up with exactly the target page's text block. start_page is the final (post-split)
// page number of the first half — each half prints its own computed number, since the built-in
// counter only advances once per double page.
export function generate_typst_facing(
    request:TypstRequest, passage:TypstPassage, start_page = 1,
):string {
    const {page, typography} = request

    // Fixed left/right margins (no inside/outside alternation across double pages)
    const margin = `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
        + `left: ${page.margin_right}, right: ${page.margin_right})`

    // One centred page number per half: left half = start + 2(n-1), right half = one more
    const footer = request.show_pages
        ? `context {
        let n = counter(page).get().first()
        grid(columns: (1fr, 1fr), column-gutter: 2 * ${page.margin_left},
            align(center, text(size: 7pt, str(${start_page} + 2 * (n - 1)))),
            align(center, text(size: 7pt, str(${start_page} + 2 * n - 1))))
    }`
        : 'none'

    const parts:string[] = []
    parts.push(gen_preamble(request, {width: `2 * ${page.width}`, margin, footer}))
    parts.push(gen_passage_facing(passage, page, request.image_style,
        typography.font_size, typography.font_text2,
        typography.font_headings2, typography.font_fallbacks,
        `2 * ${page.margin_left}`,
        `${page.width} - ${page.margin_left} - ${page.margin_right}`))
    return parts.join('\n\n')
}


// Generate a minimal Typst document for a blank page (used in post-processing)
export function generate_typst_blank(request:TypstRequest):string {
    return `#set page(
    width: ${request.page.width},
    height: ${request.page.height},
    margin: (top: ${request.page.margin_top}, bottom: ${request.page.margin_bottom},
        left: ${request.page.margin_left}, right: ${request.page.margin_right}),
)`
}


// Generate a minimal Typst document for a lines page (used in post-processing)
export function generate_typst_lines(request:TypstRequest, spacing:string):string {
    return `${generate_typst_blank(request)}

${gen_lines({type: 'lines', spacing}, request.page)}`
}


// Render a single content item to Typst
function gen_content_item(item:TypstContentItem, request:TypstRequest):string {
    switch (item.type) {
        case 'passage':
            return gen_passage(item, request.page, request.image_style,
                request.typography.font_size,
                request.typography.font_text2, request.typography.font_headings2,
                request.typography.font_fallbacks)
        case 'title':
            return gen_title(item, request.page, request.titlepage.font,
                request.titlepage.frame_svg, request.titlepage.color_text,
                request.titlepage.color_frame, request.titlepage.icon_size)
        case 'custom':
            return gen_custom(item)
        case 'lines':
            return gen_lines(item, request.page)
        case 'picture_story':
            return gen_picture_story(item, request.page, request.image_style)
    }
}
