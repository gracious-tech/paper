
import {escape_typst_str} from 'typst-utils'

import {LARGE_POETRY, LOTS_OF_POETRY, escape_typst, parse_unit} from './helpers.js'
import {build_aligned_rows} from './bilingual.js'

import type {PageConfig, TypstPassage, TypstPassageImage} from './types.js'


// Generate Typst markup for a passage's image, shown in the top half of its first page before
// any headings/content. 'padded' stays within the normal page margins (plain in-flow content);
// 'borderless' bleeds to the true page edge (place()'d outside the margin box, with a #v()
// spacer to reserve the same vertical space in the flow so subsequent content isn't overlapped)
function gen_passage_image(
    image:TypstPassageImage, page:PageConfig, image_style:'borderless'|'padded',
):string {
    const filename = escape_typst_str(image.filename)
    const page_h = parse_unit(page.height)
    const half_h = `${(page_h.num / 2).toFixed(2)}${page_h.unit}`

    if (image_style === 'borderless') {
        return `#v(${half_h})
#place(top + left, dx: -${page.margin_left}, dy: -${page.margin_top},
    image("${filename}", width: ${page.width}, height: ${half_h}, fit: "cover"))`
    }

    // Padded: normal in-flow content already respects the page's margins. Height is measured
    // from the current flow position, so subtracting the top margin keeps the image's bottom
    // edge at the page's true half-way line (matching the borderless variant)
    const content_h = `${half_h} - ${page.margin_top}`
    return `#box(width: 100%, height: ${content_h}, clip: true,
    image("${filename}", width: 100%, height: 100%, fit: "cover"))`
}


// Generate Typst markup for a Bible passage content item. font_size is the document text size
// (used to anchor heading sizes). font_text2/font_headings2/font_size2/font_fallbacks are only
// used when a second translation is actually rendered side-by-side (grid layout with 2 bibles)
// — see gen_multi_bible_grids
export function gen_passage(
    passage:TypstPassage, page:PageConfig, image_style:'borderless'|'padded',
    font_size:string, font_text2:string, font_headings2:string, font_size2:string,
    font_fallbacks:string[],
):string {
    const parts:string[] = []

    // Optional image, shown before any title/heading/content
    if (passage.image) {
        parts.push(gen_passage_image(passage.image, page, image_style))
        parts.push('')
    }

    // Optional passage title + subtitle (no icon — that's only for full title pages). On a
    // 2-column page it floats at the parent (page) scope so it spans the full width above both
    // columns — a plain block would sit inside the first column
    if (passage.passage_title) {
        const title = `text(weight: "bold", size: 1.2em,
            [${escape_typst(passage.passage_title)}])`
        const block = passage.passage_subtitle
            ? `stack(spacing: 0.3em, align(center, ${title}),
                align(center, text(size: 1em, [${escape_typst(passage.passage_subtitle)}])))`
            : `align(center, ${title})`
        if (passage_columns(passage) === 2) {
            parts.push(`#place(top + center, scope: "parent", float: true, ${block})`)
        } else {
            parts.push(`#${block}`)
        }
        parts.push('')
    }

    // Determine if we use multi-bible side-by-side grid (columns layout with 2+ bibles)
    const use_grid = passage.bibles.length > 1 && passage.multi_layout === 'columns'

    // Build the scoped block with passage-specific function definitions and show rules
    const inner = gen_passage_inner(passage, use_grid, font_size, font_text2, font_headings2,
        font_size2, font_fallbacks, passage.column_gap, null)

    // Wrap in a scoped block so settings don't leak to other content
    parts.push(`#[
${inner}
]`)

    return parts.join('\n')
}


// Generate a passage for a double-width facing-pages document (see generate_typst_facing):
// the aligned rows' two columns become the two facing pages once post-processing splits each
// page down the centre. gutter is the centre gap (2x the inner margin, so each half keeps the
// target page's text width) and entry_width confines footnote entries to the left half so a
// long note can't straddle the cut.
export function gen_passage_facing(
    passage:TypstPassage, page:PageConfig, image_style:'borderless'|'padded',
    font_size:string, font_text2:string, font_headings2:string, font_size2:string,
    font_fallbacks:string[], gutter:string, entry_width:string,
):string {
    const parts:string[] = []

    // The image repeats on both halves too, same as the title block below
    if (passage.image) {
        const half = gen_passage_image(passage.image, page, image_style)
        parts.push(`#grid(columns: (1fr, 1fr), column-gutter: ${gutter},
    ${half},
    ${half})`)
        parts.push('')
    }

    // The passage title (+ optional subtitle) repeats on both halves, since each becomes its
    // own physical page
    if (passage.passage_title) {
        const title = `align(center, text(weight: "bold", size: 1.2em,
            [${escape_typst(passage.passage_title)}]))`
        const subtitle = passage.passage_subtitle
            ? `align(center, text(size: 1em, [${escape_typst(passage.passage_subtitle)}]))`
            : null
        const block = subtitle ? `stack(spacing: 0.3em, ${title}, ${subtitle})` : title
        parts.push(`#grid(columns: (1fr, 1fr), column-gutter: ${gutter},
    ${block},
    ${block})`)
        parts.push('')
    }

    // Same scoped block as gen_passage, with the facing gutter and footnote width constraint
    const inner = gen_passage_inner(passage, true, font_size, font_text2, font_headings2,
        font_size2, font_fallbacks, gutter, entry_width)
    parts.push(`#[
${inner}
]`)

    return parts.join('\n')
}


// Column count for a passage's pages. Columns are set at page level by the caller (see
// generate_typst) rather than wrapping content in a #columns block — footnote layout cost
// scales with the enclosing region, and a book-length block made large books explode in
// memory, while a page-sized region stays cheap. Multi-translation passages already split
// the page (side-by-side grid or facing halves), so they never combine with text columns.
export function passage_columns(passage:TypstPassage):1|2 {
    if (passage.bibles.length > 1) {
        return 1
    }
    if (passage.columns === 1) {
        return 1
    }
    if (passage.columns === 2) {
        return 2
    }
    // Auto: use columns for large poetry books
    return LARGE_POETRY.includes(passage.book) ? 2 : 1
}


// Generate the inner content of a passage block (function defs, show rules, content).
// gutter is the grid column gap when a multi-bible grid renders; entry_width (facing pages
// only) confines footnote entries to the left half of the double page.
function gen_passage_inner(
    passage:TypstPassage, use_grid:boolean,
    font_size:string, font_text2:string, font_headings2:string, font_size2:string,
    font_fallbacks:string[], gutter:string, entry_width:string|null,
):string {
    const lines:string[] = []


    // Heading show rules
    lines.push(gen_heading_rules(passage, font_size))

    // Footnote show rules
    lines.push(gen_footnote_rules(passage, entry_width))

    // Disable first-line-indent for poetry-heavy books
    if (LOTS_OF_POETRY.includes(passage.book)) {
        lines.push('#set par(first-line-indent: 0em)')
    }

    // A heading (or the 'float' chapter marker's own block(), see chapter in preamble.ts)
    // normally precedes the passage's first paragraph, which is what stops Typst's
    // first-line-indent (all: false) from indenting it — that rule only skips a paragraph
    // immediately preceded by a non-paragraph flow item. When headings/chapters are hidden
    // (e.g. the "reading" preset) or absent from the source content, nothing plays that role,
    // so the passage's opening paragraph would wrongly get indented like a mid-flow
    // continuation. A zero-height block guarantees that role unconditionally, regardless of
    // heading/chapter settings — height/below 0pt keeps it invisible and spacing-neutral (an
    // equivalent #metadata(none) marker does NOT work: Typst ignores metadata entirely when
    // deciding whether the next paragraph follows a paragraph)
    lines.push('#block(below: 0pt, height: 0pt)')

    // Render the content (any 2-column layout comes from the page setting, not a block)
    if (use_grid) {
        lines.push(gen_multi_bible_grids(
            passage, gutter, font_text2, font_headings2, font_size2, font_fallbacks))
    } else {
        lines.push(passage.bibles[0]!.content)
    }

    return lines.join('\n')
}


// Generate heading show rules
function gen_heading_rules(passage:TypstPassage, font_size:string):string {
    if (!passage.show_headings) {
        return '#show heading: none'
    }

    // User-configurable subheading styling — bold/italic apply to all levels, while size is a
    // multiplier relative to the body text (1 = same as text). Level 2 (== Section: s, s1-4, sr)
    // is the reference size, level 1 (= Title: ms, mr) renders slightly larger and level 3
    // (=== Minor: sp, qa, superscriptions) slightly smaller.
    const weight = passage.headings_bold ? '"bold"' : '"regular"'
    const style = passage.headings_italic ? '"italic"' : '"normal"'
    const size = (mult:number) => `${(passage.headings_size * mult).toFixed(2)}em`

    // Reset the heading base size to the document text size (absolute, so Typst's built-in
    // per-level em scaling — 1.4em/1.2em/1em — can't compound with the em sizes below).
    // Wrap each heading body in a `block` so it isn't treated as a continuation
    // paragraph — otherwise the document's first-line-indent would indent it.
    //
    // Each rule drops its leading `v()` when the "ch-float-open" flag is set — i.e. when the
    // heading immediately follows a 'float'-style chapter marker (see preamble.ts). That lets the
    // heading rise to sit level with the big margin numeral instead of being pushed below it. The
    // flag is read then cleared here, so it only affects the chapter's first heading; it is never
    // set under the other chapter styles, so those keep their normal leading unconditionally.
    // `block(above: 0pt)` keeps that suppression clean — the (kept) `v()` is then the only
    // leading space, matching the previous rendering for non-chapter-opening headings.
    const lead = (space:string, mult:number) => `it => context {
    let open = state("ch-float-open", false).get()
    state("ch-float-open", false).update(false)
    if not open { v(${space}) }
    block(above: 0pt, text(weight: ${weight}, style: ${style}, size: ${size(mult)}, it.body))`
    return `#show heading: set text(size: ${font_size})
#show heading.where(level: 1): ${lead('1.2em', 1.2)}
    v(0.25em)
}
#show heading.where(level: 2): ${lead('1.5em', 1)}
    v(0.2em)
}
#show heading.where(level: 3): ${lead('0.6em', 0.9)}
    v(0.15em)
}`
}


// Generate footnote show rules. entry_width (facing pages only) wraps each entry in a
// width-capped box so it stays within the left half of the double page — the constraint must
// live inside whichever entry show rule is active, since a later-defined rule on the same
// element replaces an earlier one rather than composing with it.
function gen_footnote_rules(passage:TypstPassage, entry_width:string|null):string {
    if (!passage.show_footnotes) {
        // Shadow the footnote function so notes are never registered. A `#show footnote: none`
        // rule only hides the in-text call — the entry and separator still render at page bottom
        // (and entry show rules can't reach the page footnote area from this scoped block).
        const lines = ['#let footnote(..args) = none']
        // Study notes call the preamble-captured footnote (see gen_preamble), so their entries
        // still render — keep them within the left half on facing pages
        if (entry_width !== null) {
            lines.push(`#show footnote.entry: it => box(width: ${entry_width}, it)`)
        }
        return lines.join('\n')
    }

    const lines:string[] = []

    // Enumerate footnotes alphabetically (a, b, c, …aa, ab…) so each in-text call shows a
    // visible superscript letter marking the word/phrase the note refers to
    lines.push('#set footnote(numbering: "a")')

    // Footnote entry styling (the content at page bottom), prefixed with its matching mark so
    // readers can pair each note with its superscript call in the text
    const entry = `{
    super(numbering("a", ..counter(footnote).at(it.note.location())))
    h(1pt)
    it.note.body
}`
    lines.push(entry_width === null
        ? `#show footnote.entry: it => ${entry}`
        : `#show footnote.entry: it => box(width: ${entry_width}, ${entry})`)

    return lines.join('\n')
}


// Generate the aligned two-translation layout: one #grid per alignment row (verse/paragraph/
// chapter — the primary translation's boundaries drive both sides, see bilingual.ts). Each
// grid is its own layout container, which is what keeps footnote layout affordable: a single
// passage-length grid forces Typst to re-lay the whole passage per footnote (gigabytes of
// memory for a footnote-heavy book), while row-sized containers stay page-cheap. The second
// cell gets its own font scope (see Blueprint.font_text2) and shadows #footnote — notes
// render once, from the primary translation only.
function gen_multi_bible_grids(
    passage:TypstPassage, gutter:string,
    font_text2:string, font_headings2:string, font_size2:string, font_fallbacks:string[],
):string {
    const fonts2 = [font_text2, ...font_fallbacks].map(f => `"${escape_typst_str(f)}"`).join(', ')

    // set/let bindings scope to their own content block, so every second cell repeats this
    // prelude (shadowing #footnote in an outer scope wouldn't reach markup evaluated here)
    const prelude2 = `#let footnote(..args) = none
#set text(font: (${fonts2}), size: ${font_size2})
#show heading: set text(font: "${escape_typst_str(font_headings2)}")`

    const rows = build_aligned_rows(
        passage.bibles[0]!.content, passage.bibles[1]?.content ?? '', passage.multi_align)
    return rows.map(([a, b]) => `#grid(
    columns: (1fr, 1fr),
    column-gutter: ${gutter},
    align: top,
[
${a}
],
[
${prelude2}
${b}
],
)`).join('\n\n')
}
