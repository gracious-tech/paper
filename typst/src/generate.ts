
import {escape_typst_str} from 'typst-utils'

import {gen_preamble, gen_furniture_cell, gen_furniture_slots, FURNITURE_HEADING,
    FURNITURE_RULES} from './preamble.js'
import {gen_passage, gen_passage_facing, passage_columns} from './content_passage.js'
import {gen_title} from './content_title.js'
import {gen_custom} from './content_custom.js'
import {gen_lines} from './content_lines.js'
import {gen_picture_story} from './content_picture_story.js'
import {parse_unit, to_pt} from './helpers.js'

import type {PreambleOverrides} from './preamble.js'
import type {PageConfig, TypstRequest, TypstContentItem, TypstPassage} from './types.js'


// How a compile's margins relate to the physical page — either Typst's own inside/outside swap
// (alternating each page by parity, for ordinary continuous book flow) or a fixed physical side
// pinned for every page of the compile (for half-blank/notetaking layouts, where content must
// stay on the same side as its facing notes page throughout — even across multiple content
// pages, which Typst's own binding would otherwise alternate internally)
export type MarginMode =
    | {kind:'alternating', binding:'left'|'right'}
    | {kind:'fixed', side:'left'|'right'}


// Build the #set page margin dict + binding for a MarginMode. 'fixed' 'left' means this page is
// always the verso/left half of a spread, so its near-spine (inner) margin sits on the physical
// right; 'right' (recto) puts inner on the physical left
function margin_overrides(page:PageConfig, mode:MarginMode):{margin:string, binding:'left'|'right'} {
    if (mode.kind === 'alternating') {
        return {
            binding: mode.binding,
            margin: `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
                + `inside: ${page.margin_left}, outside: ${page.margin_right})`,
        }
    }
    const [left, right] = mode.side === 'left'
        ? [page.margin_right, page.margin_left]
        : [page.margin_left, page.margin_right]
    return {
        binding: mode.side,
        margin: `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
            + `left: ${left}, right: ${right})`,
    }
}


// Generate a single Typst document string from a request
// This is the "inner" function — produces a compilable .typ file
// For features that need multi-document compilation (alternate interleaving, half-blank),
// use generate_pdf() instead which handles the full pipeline
// start_page offsets the built-in page counter so numbering stays continuous when a book is
// assembled from several separately-compiled documents (see compile_group in pdf_postprocess.ts).
// margin_mode defaults to alternating-by-start_page-parity (see margin_overrides); half-blank
// passages pass a 'fixed' mode instead (see pdf_postprocess.ts)
export function generate_typst(request:TypstRequest, start_page = 1, margin_mode?:MarginMode):string {
    const parts:string[] = []

    // Must precede any page content to take effect on this document's first page
    if (start_page > 1) {
        parts.push(`#counter(page).update(${start_page})`)
    }

    // Each content item compiles as its own document, so its physical first page is always
    // "odd" as far as Typst's inside/outside margin swap is concerned — counter(page).update()
    // above only affects displayed numbers, not that swap. When this item's true position in
    // the assembled book is an even page, flip the binding so "inside" still lands on the
    // correct physical side (see margin_overrides)
    const mode = margin_mode ?? {kind: 'alternating', binding: start_page % 2 === 0 ? 'right' : 'left'}

    // Document preamble (page, fonts, paragraph, footer)
    parts.push(gen_preamble(request, margin_overrides(request.page, mode)))

    // What the preamble's own justification rule left in effect — items only emit their own
    // where their answer differs from it, and each one that does stays in effect for the items
    // after it (a set rule at this level runs to the end of the document), so this tracks it
    let justified = request.typography.justify !== false

    // Render each content item on its own page(s)
    for (let i = 0; i < request.content.length; i++) {
        const item = request.content[i]!

        if (i > 0) {
            parts.push('#pagebreak()')
        }

        // Set the item's column count on the page itself (a set page rule on the fresh empty
        // page reconfigures it without inserting another break)
        parts.push(gen_page_columns(item))

        // Justification for this item's own text — see item_justifies
        if (item_justifies(item, request) !== justified) {
            justified = !justified
            parts.push(`#set par(justify: ${justified})`)
        }

        // Reset the running-heading state for this item — see gen_running_state_reset
        parts.push(gen_running_state_reset(item))

        parts.push(gen_content_item(item, request))
    }

    return parts.join('\n\n')
}


// The fixed physical side a half-blank passage's content lives on, given which side its facing
// notes page is pinned to (null when the passage isn't half-blank at all). Shared by the
// running-heading override below and pdf_postprocess.ts's margin-mode wiring (assemble_pages/
// process_faced), so both agree on which side is which
export function half_blank_content_side(half_blank:'left'|'right'|null):'left'|'right'|null {
    if (half_blank === 'left') {
        return 'right'
    }
    if (half_blank === 'right') {
        return 'left'
    }
    return null
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
    const content_side = half_blank_content_side(item.half_blank)
    const side = content_side ? `"${content_side}"` : 'none'
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


// Average character advance of a text serif as a fraction of the font size — enough to turn a
// measure into an approximate characters-per-line count. The thresholds below are soft, so a
// wider or narrower face shifting this a little doesn't change the outcome.
const AVG_CHAR_EM = 0.5

// Characters-per-line floors for justifying. Printed bibles justify two-column text at ~30
// characters a line, which optimal line breaking plus hyphenation fills cleanly. Without
// hyphenation the breaker can't split a word to fill a line, so it needs a comfortably wider
// measure before justification stops opening rivers of whitespace.
const JUSTIFY_MIN_CHARS = 30
const JUSTIFY_MIN_CHARS_NO_HYPHEN = 45


// Approximate characters per line of an item's measure: the page's text width, or half of it
// (less the gap) when a passage sets its text in two columns — either a 2-column page or the
// bilingual 'columns' layout's grid cells, which are mutually exclusive (a multi-bible passage
// is always single-column, see passage_columns). Facing pages aren't narrow — each half of the
// double page is a full page's measure — and they never reach here anyway (generate_typst_facing).
function item_chars_per_line(item:TypstContentItem, page:PageConfig, font_size:string):number {
    const pt = (value:string) => {
        const {num, unit} = parse_unit(value)
        return to_pt(num, unit)
    }
    let measure = pt(page.width) - pt(page.margin_left) - pt(page.margin_right)
    if (item.type === 'passage'
            && (passage_columns(item) === 2
                || (item.bibles.length > 1 && item.multi_layout === 'columns'))) {
        measure = (measure - pt(item.column_gap)) / 2
    }
    return measure / (AVG_CHAR_EM * pt(font_size))
}


// Whether an item's text is justified (the caller emits a rule only where this differs from
// what the preamble already set). Only running text ever is — a passage or a custom page —
// so title pages, lines pages and picture stories are never justified whatever the blueprint
// says: their text is display-size, hand-placed or fitted to its box at render time (a picture
// story's body runs up to 3x the body size, a few words a line), none of which is a measure
// worth stretching to. For running text an explicit blueprint choice wins, and 'auto' (null)
// justifies only where the measure holds enough characters to fill a line without opening
// rivers of whitespace.
function item_justifies(item:TypstContentItem, request:TypstRequest):boolean {
    if (item.type !== 'passage' && item.type !== 'custom') {
        return false
    }
    const {justify, hyphenate, font_size} = request.typography
    if (justify !== null) {
        return justify
    }
    const min = hyphenate ? JUSTIFY_MIN_CHARS : JUSTIFY_MIN_CHARS_NO_HYPHEN
    return item_chars_per_line(item, request.page, font_size) >= min
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
        typography.font_headings2, typography.font_size2, typography.font_fallbacks2,
        typography.line_height,
        `2 * ${page.margin_left}`,
        `${page.width} - ${page.margin_left} - ${page.margin_right}`,
        typography.poetry_outdent))
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

    // Same running heading text on both halves, but each half computes its own page number.
    // Ungated (unlike the general case) — a facing compile is a single passage end to end, so
    // every one of its pages is a passage page
    const heading = gen_furniture_cell(request.running_headings, FURNITURE_HEADING, false)
    const number = (expr:string) =>
        gen_furniture_cell(request.running_pages, `str(${expr})`, false)
    const left = gen_furniture_slots(request, number(`${start_page} + 2 * (n - 1)`), heading)
    const right = gen_furniture_slots(request, number(`${start_page} + 2 * n - 1`), heading)

    return `{
        ${FURNITURE_RULES}
        let n = counter(page).get().first()
        grid(columns: (1fr, 1fr), column-gutter: ${gutter},
            ${furniture_half_row(false, left.outer, left.center)},
            ${furniture_half_row(true, right.outer, right.center)},
        )
    }`
}


// Generate a minimal Typst document for a blank page (used in post-processing). Blank/lines
// pages are pre-compiled once and their single page reused at many different positions, so
// callers pick the right MarginMode up front for however this instance will be used: generic
// padding blanks alternate by true absolute parity, while notetaking facing pages need a fixed
// side (see margin_overrides and pdf_postprocess.ts's assemble_pages/process_faced)
export function generate_typst_blank(
    request:TypstRequest, margin_mode:MarginMode = {kind: 'alternating', binding: 'left'},
):string {
    const overrides = margin_overrides(request.page, margin_mode)
    return `#set page(
    width: ${request.page.width},
    height: ${request.page.height},
    margin: ${overrides.margin},
    binding: ${overrides.binding},
)`
}


// Generate a minimal Typst document for a lines page (used in post-processing)
export function generate_typst_lines(
    request:TypstRequest, spacing:string,
    margin_mode:MarginMode = {kind: 'alternating', binding: 'left'},
):string {
    return `${generate_typst_blank(request, margin_mode)}

${gen_lines({type: 'lines', spacing})}`
}


// Render a single content item to Typst
function gen_content_item(item:TypstContentItem, request:TypstRequest):string {
    switch (item.type) {
        case 'passage':
            return gen_passage(item, request.page, request.image_style,
                request.typography.font_size,
                request.typography.font_text2, request.typography.font_headings2,
                request.typography.font_size2, request.typography.font_fallbacks2,
                request.typography.line_height,
                request.features.show_chapters ? request.features.show_chapters_style : 'none',
                request.typography.poetry_outdent)
        case 'title':
            return gen_title(item, request.page, request.titlepage.font,
                request.titlepage.frame_svg, request.titlepage.color_text,
                request.titlepage.color_frame, request.titlepage.text_size,
                request.titlepage.icon_size)
        case 'custom':
            return gen_custom(item)
        case 'lines':
            return gen_lines(item)
        case 'picture_story':
            return gen_picture_story(item, request.page, request.image_style,
                request.story_layout, request.story_alternate, request.typography.line_height,
                request.typography.font_size, request.typography.font_text2,
                request.typography.font_size2, request.typography.font_fallbacks2)
    }
}
