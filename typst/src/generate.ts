
import {escape_typst_str} from 'typst-utils'

import {gen_preamble} from './preamble.js'
import {gen_passage, gen_passage_facing, passage_columns} from './content_passage.js'
import {gen_title} from './content_title.js'
import {gen_custom} from './content_custom.js'
import {gen_lines} from './content_lines.js'
import {gen_picture_story} from './content_picture_story.js'

import type {PreambleOverrides} from './preamble.js'
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

        // Reset the running-heading state for this item — see gen_running_state_reset
        parts.push(gen_running_state_reset(item))

        parts.push(gen_content_item(item, request))
    }

    return parts.join('\n\n')
}


// Reset the running-heading state (read by preamble.ts's page-furniture row) at the start of
// each content item. Passages seed book/chapter/side from their own data — further updated by
// #ch(n) calls as content progresses through the item, see preamble.ts — while every other item
// type just marks the running heading inactive, since title/custom/lines/picture-story pages
// have no book/chapter to show
function gen_running_state_reset(item:TypstContentItem):string {
    if (item.type !== 'passage') {
        return '#state("running-active", false).update(false)'
    }
    // half_blank passages always land on a fixed physical side regardless of the page — see
    // process_faced in pdf_postprocess.ts — so the live per-page parity check in preamble.ts
    // is overridden with that fixed side instead
    const side = item.half_blank === 'left' ? '"right"'
        : item.half_blank === 'right' ? '"left"'
        : 'none'
    return `#state("running-active", false).update(true)
#state("running-book", "").update("${escape_typst_str(item.book_name)}")
#state("running-chapter", 0).update(${item.start_chapter})
#state("running-side", none).update(${side})`
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

    // Page number + running heading, into whichever slot (header/footer) the blueprint
    // chose — always overridden explicitly (even when 'none') rather than left to
    // gen_preamble's own default, since that default's dynamic left/right parity check
    // doesn't apply to a facing document's fixed left-half/right-half layout
    const gutter = `2 * ${page.margin_left}`
    const furniture = gen_facing_furniture(request, start_page, gutter)
    const overrides:PreambleOverrides = {width: `2 * ${page.width}`, margin}
    if (request.running_position === 'footer') {
        overrides.footer = furniture === 'none' ? 'none' : `context ${furniture}`
    } else {
        overrides.header = furniture === 'none'
            ? 'context counter(footnote).update(0)'
            : `context {
    counter(footnote).update(0)
    ${furniture}
}`
    }

    const parts:string[] = []
    parts.push(gen_preamble(request, overrides))
    // Seed the running-heading state for this passage — facing documents don't go through
    // generate_typst's per-item loop, so this mirrors gen_running_state_reset manually. A
    // facing passage can itself span multiple chapters, so #ch(n) calls within its content
    // (via gen_passage_facing below) keep advancing the chapter from here, same as any other
    // passage. running-side isn't relevant here — facing pages don't interact with half_blank
    parts.push(`#state("running-active", false).update(true)
#state("running-book", "").update("${escape_typst_str(passage.book_name)}")
#state("running-chapter", 0).update(${passage.start_chapter})`)
    parts.push(gen_passage_facing(passage, page, request.image_style,
        typography.font_size, typography.font_text2,
        typography.font_headings2, typography.font_fallbacks,
        `2 * ${page.margin_left}`,
        `${page.width} - ${page.margin_left} - ${page.margin_right}`))
    return parts.join('\n\n')
}


// One half's 3-cell left/center/right row (mirrors the general-case layout in preamble.ts's
// gen_page_furniture_row, but with a statically known side — a facing document's two halves
// are always verso-left/recto-right, never determined dynamically)
function furniture_half_row(is_recto:boolean, outer:string, center:string):string {
    const outer_cell = `align(${is_recto ? 'right' : 'left'}, ${outer})`
    const center_cell = `align(center, ${center})`
    return is_recto
        ? `grid(columns: (1fr, 1fr, 1fr), align: horizon, none, ${center_cell}, ${outer_cell})`
        : `grid(columns: (1fr, 1fr, 1fr), align: horizon, ${outer_cell}, ${center_cell}, none)`
}


// Build the facing-pages page-number + running-heading row: each half gets its own computed
// page number (the built-in counter only advances once per double page — see start_page's doc
// comment above) but the same running heading (one passage, two translations side by side).
// Returns a raw block expression (not context-wrapped, matching gen_page_furniture_row's
// contract) or 'none' when neither feature is on — see generate_typst_facing for how it's
// combined with the header's footnote-counter reset
function gen_facing_furniture(request:TypstRequest, start_page:number, gutter:string):string {
    if (!request.running_pages && !request.running_headings) {
        return 'none'
    }

    // Same running heading text on both halves
    const heading = request.running_headings
        ? `text(size: 7pt, state("running-book", "").at(here()) + " "
            + str(state("running-chapter", 0).at(here())))`
        : 'none'
    const number = (expr:string) => request.running_pages
        ? `text(size: 7pt, str(${expr}))`
        : 'none'
    const number_left = number(`${start_page} + 2 * (n - 1)`)
    const number_right = number(`${start_page} + 2 * n - 1`)

    const outer_left = request.running_align === 'outer' ? number_left : heading
    const center_left = request.running_align === 'outer' ? heading : number_left
    const outer_right = request.running_align === 'outer' ? number_right : heading
    const center_right = request.running_align === 'outer' ? heading : number_right

    return `{
        let n = counter(page).get().first()
        grid(columns: (1fr, 1fr), column-gutter: ${gutter},
            ${furniture_half_row(false, outer_left, center_left)},
            ${furniture_half_row(true, outer_right, center_right)},
        )
    }`
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
