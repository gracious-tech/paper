
import {escape_typst_str} from 'typst-utils'

import {LARGE_POETRY, LOTS_OF_POETRY, escape_typst, parse_unit} from './helpers.js'
import {build_aligned_rows} from './bilingual.js'

import type {ImageStyle, PageConfig, TypstPassage, TypstPassageImage} from './types.js'


// How chapter markers are drawn document-wide (Blueprint show_chapters_style, or 'none' when
// chapter numbers are hidden). Only consulted for the bilingual columns layout, where the
// marker otherwise renders once inside each translation's cell — see gen_multi_bible_grids
export type ChapterStyle = 'divider' | 'float' | 'heading' | 'none'


// Generate Typst markup for a passage's image, shown in the top half of its first page before
// any headings/content. 'borderless' bleeds to the true page edge (place()'d outside the margin
// box, with a #v() spacer to reserve the same vertical space in the flow so subsequent content
// isn't overlapped); every other style stays within the normal page margins (plain in-flow
// content). 'painted'/'torn' images arrive pre-masked (irregular transparent edge baked into the
// pixels by the app before upload — see image_frame.ts) so they use fit: "contain" rather than
// "cover", which would crop back into a hard rectangle and cut the masked edge away
function gen_passage_image(
    image:TypstPassageImage, page:PageConfig, image_style:ImageStyle,
):string {
    const filename = escape_typst_str(image.filename)
    const page_h = parse_unit(page.height)
    const half_h = `${(page_h.num / 2).toFixed(2)}${page_h.unit}`

    if (image_style === 'borderless') {
        return `#v(${half_h})
#place(top + left, dx: -${page.margin_left}, dy: -${page.margin_top},
    image("${filename}", width: ${page.width}, height: ${half_h}, fit: "cover"))`
    }

    // Padded (plain/painted/torn): normal in-flow content already respects the page's margins.
    // Height is measured from the current flow position, so subtracting the top margin keeps the
    // image's bottom edge at the page's true half-way line (matching the borderless variant)
    const fit = image_style === 'padded' ? 'cover' : 'contain'
    const content_h = `${half_h} - ${page.margin_top}`
    return `#box(width: 100%, height: ${content_h}, clip: true,
    image("${filename}", width: 100%, height: 100%, fit: "${fit}"))`
}


// Generate Typst markup for a Bible passage content item. font_size is the document text size
// (used to anchor heading sizes). font_text2/font_headings2/font_size2/font_fallbacks2 are only
// used when a second translation is actually rendered side-by-side (grid layout with 2 bibles)
// — see gen_multi_bible_grids
export function gen_passage(
    passage:TypstPassage, page:PageConfig, image_style:ImageStyle,
    font_size:string, font_text2:string, font_headings2:string, font_size2:string,
    font_fallbacks2:string[], line_height:number, chapter_style:ChapterStyle,
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
            // Generous bottom margin so the book title stands clearly apart from the passage
            // (a bare paragraph break would leave it only one line's gap above the first verse).
            // width: 100% so the inner align(center) centres across the page, not the block's
            // shrink-wrapped content width
            parts.push(`#block(width: 100%, below: 2.8em, ${block})`)
        }
        parts.push('')
    }

    // Determine if we use multi-bible side-by-side grid (columns layout with 2+ bibles)
    const use_grid = passage.bibles.length > 1 && passage.multi_layout === 'columns'

    // Build the scoped block with passage-specific function definitions and show rules
    const inner = gen_passage_inner(passage, use_grid, font_size, font_text2, font_headings2,
        font_size2, font_fallbacks2, line_height, passage.column_gap, null, chapter_style)

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
    passage:TypstPassage, page:PageConfig, image_style:ImageStyle,
    font_size:string, font_text2:string, font_headings2:string, font_size2:string,
    font_fallbacks2:string[], line_height:number, gutter:string, entry_width:string,
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
        // Generous bottom margin so the book title stands clearly apart from the passage (a
        // bare paragraph break would leave it only one line's gap above the first verse)
        parts.push(`#block(width: 100%, below: 2.8em, grid(columns: (1fr, 1fr), column-gutter: ${gutter},
    ${block},
    ${block}))`)
        parts.push('')
    }

    // Same scoped block as gen_passage, with the facing gutter and footnote width constraint.
    // Chapter markers stay per-translation here: each half is split into its own physical page,
    // so a full-width divider would be cut in two and the second half's margin numeral lands in
    // a real inside margin — both already correct without the columns-layout adjustment.
    const inner = gen_passage_inner(passage, true, font_size, font_text2, font_headings2,
        font_size2, font_fallbacks2, line_height, gutter, entry_width, 'none')
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
    font_fallbacks2:string[], line_height:number, gutter:string, entry_width:string|null,
    chapter_style:ChapterStyle,
):string {
    const lines:string[] = []


    // Heading show rules
    lines.push(gen_heading_rules(passage, font_size, line_height))

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
            passage, gutter, font_text2, font_headings2, font_size2, font_fallbacks2, line_height,
            chapter_style))
    } else {
        lines.push(passage.bibles[0]!.content)
    }

    return lines.join('\n')
}


// Heading margins, expressed as fractions of one body line's advance (the `line_height` setting
// × font size — the same unit the body uses for its own leading/paragraph spacing) so a user's
// line_height opens up or tightens the space around headings in step with the text. The values
// are picked to land on the previous fixed ems at the default line_height (1.75).
const HEADING_MARGIN_LINES = {
    1: {before: 0.91, after: 0.51},
    2: {before: 1.09, after: 0.49},  // == Section: the common subheading
    3: {before: 0.54, after: 0.34},
}
// The two-column grid can't use a heading's own leading `v()` for its top margin (a heading
// that opens a grid cell has that `v()` suppressed — see gen_heading_rules); it puts
// `HEADING_MARGIN_LINES[2].before + GRID_LEAD_EXTRA_LINES` on the whole row instead. The extra
// compensates for the single-column heading keeping its font ascent above the baseline while
// the grid heading's top-edge is flattened level with the other translation — without it the
// grid gap reads noticeably tighter.
const GRID_LEAD_EXTRA_LINES = 0.4


// Generate heading show rules. line_height is the body line advance multiplier (Blueprint
// line_height) — heading margins scale with it, see HEADING_MARGIN_LINES.
function gen_heading_rules(passage:TypstPassage, font_size:string, line_height:number):string {
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

    // A vertical gap of `lines` body-line advances, as an em of the body text size
    const gap = (lines:number) => `${(lines * line_height).toFixed(3)}em`

    // Reset the heading base size to the document text size (absolute, so Typst's built-in
    // per-level em scaling — 1.4em/1.2em/1em — can't compound with the em sizes below).
    // Wrap each heading body in a `block` so it isn't treated as a continuation
    // paragraph — otherwise the document's first-line-indent would indent it.
    //
    // Each rule drops its leading `v()` in two cases, so a heading doesn't get pushed below
    // where it should sit:
    //   - "ch-float-open": the heading immediately follows a 'float'-style chapter marker (see
    //     preamble.ts), so it should rise to sit level with the big margin numeral.
    //   - "bilingual-cell-top": the heading is the first thing in its side-by-side grid cell
    //     (see gen_multi_bible_grids). With no content above it in the cell there's nothing to
    //     separate from, and the leading space would drop it a whole line below the other
    //     translation's first line (which opens straight into text).
    // Both flags are read then cleared here, so only the first heading of the chapter/cell is
    // affected. On top of dropping the leading `v()`, the cell-top case also flattens the
    // heading's top-edge to the baseline (`block(above: 0pt)` alone still leaves the font's
    // ascent as a visible gap above the glyphs) so the heading baseline lands level with the
    // other side's first text line, whose paragraph top-edge is likewise collapsed to 0. The
    // float-chapter case keeps the natural top-edge — its target is the big margin numeral, not
    // a text baseline.
    const lead = (before:number, mult:number) => `it => context {
    let open = state("ch-float-open", false).get()
    state("ch-float-open", false).update(false)
    let cell_top = state("bilingual-cell-top", false).get()
    state("bilingual-cell-top", false).update(false)
    if not open and not cell_top { v(${gap(before)}) }
    block(above: 0pt, {
        set text(top-edge: 0pt) if cell_top
        text(weight: ${weight}, style: ${style}, size: ${size(mult)}, it.body)
    })`
    // The `v()` before (via lead()) and after each heading are its top and bottom margins —
    // enough space that a subheading reads as a clear break from the preceding text and as
    // attached to (not crammed against) the text it introduces
    const m = HEADING_MARGIN_LINES
    return `#show heading: set text(size: ${font_size})
#show heading.where(level: 1): ${lead(m[1].before, 1.2)}
    v(${gap(m[1].after)})
}
#show heading.where(level: 2): ${lead(m[2].before, 1)}
    v(${gap(m[2].after)})
}
#show heading.where(level: 3): ${lead(m[3].before, 0.9)}
    v(${gap(m[3].after)})
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
    font_text2:string, font_headings2:string, font_size2:string, font_fallbacks2:string[],
    line_height:number, chapter_style:ChapterStyle,
):string {
    const fonts2 = [font_text2, ...font_fallbacks2].map(f => `"${escape_typst_str(f)}"`).join(', ')

    // Every cell opens with this:
    //   - A zero-height block, so the cell's first paragraph counts as following a block —
    //     that's what makes the document's `#show par: set text(top-edge/bottom-edge: 0)`
    //     (uniform leading) and first-line-indent suppression apply to it. Without it a cell
    //     starting straight into a paragraph renders that paragraph with metric-based line
    //     height, so its leading visibly differs from sibling rows (most obvious with tall
    //     stacked-diacritic scripts). Same trick as gen_passage_inner.
    //   - The "bilingual-cell-top" flag, so a heading that's the first thing in the cell drops
    //     its leading space and sits level with the other translation's first line rather than
    //     a line lower (see the heading rules in gen_heading_rules).
    const cell_open = '#block(below: 0pt, height: 0pt)\n'
        + '#state("bilingual-cell-top", false).update(true)'

    // set/let bindings scope to their own content block, so every second cell repeats this
    // prelude (shadowing #footnote in an outer scope wouldn't reach markup evaluated here)
    const prelude2 = `${cell_open}
#let footnote(..args) = none
#set text(font: (${fonts2}), size: ${font_size2})
#show heading: set text(font: "${escape_typst_str(font_headings2)}")`

    const rows = build_aligned_rows(
        passage.bibles[0]!.content, passage.bibles[1]?.content ?? '', passage.multi_align)

    // A row whose chunk opens with a section heading (after an optional #ch marker). The
    // heading's own leading v() is suppressed at a cell top (see gen_heading_rules), so the
    // margin before it has to be added at the row level instead — on the whole grid, so both
    // columns shift together and stay aligned. Matches the single-column heading's top margin
    // (see the HEADING_MARGIN_LINES / GRID_LEAD_EXTRA_LINES notes) and scales with line_height
    // the same way. Weak so it collapses away at a page top.
    const heading_row = /^\s*(#ch\(\d+\)\s*)?={1,6}\s/
    const row_lead_em =
        ((HEADING_MARGIN_LINES[2].before + GRID_LEAD_EXTRA_LINES) * line_height).toFixed(3)
    const row_lead = `#v(${row_lead_em}em, weak: true)\n`

    return rows.map(([a, b], i) => {
        // The chapter marker sits in the pre-rendered markup of *both* translations, so left
        // alone it renders twice — once per column. For the 'divider' style, quiet both in-cell
        // markers and draw one divider across the full grid width instead; for the 'float'
        // (drop-cap) style, keep the primary translation's margin numeral and quiet the second's
        // (it would otherwise land in the column gutter). 'heading' and 'none' are left as-is.
        let cell_a = a
        let cell_b = b
        let full_divider = ''
        if (chapter_style === 'divider') {
            // The primary translation's boundaries drive the split, so its chunk carries the
            // #ch on every chapter-opening row; fall back to the second's just in case
            const match = /#ch\((\d+)\)/.exec(a) ?? /#ch\((\d+)\)/.exec(b)
            if (match) {
                cell_a = quiet_chapter_markers(a)
                cell_b = quiet_chapter_markers(b)
                // Chapter 1's divider is suppressed anyway (see #ch in preamble.ts)
                if (Number(match[1]) > 1) {
                    full_divider = `#ch_divider(${match[1]})\n`
                }
            }
        } else if (chapter_style === 'float') {
            cell_b = quiet_chapter_markers(b)
        }

        const lead = i > 0 && (heading_row.test(a) || heading_row.test(b)) ? row_lead : ''
        return `${full_divider}${lead}#grid(
    columns: (1fr, 1fr),
    column-gutter: ${gutter},
    align: top,
[
${cell_open}
${cell_a}
],
[
${prelude2}
${cell_b}
],
)`
    }).join('\n\n')
}


// Swap every chapter marker in a chunk of pre-rendered markup for the state-only #ch_quiet
// (see preamble.ts) — it advances the running chapter without drawing anything, used where the
// bilingual columns layout draws the marker itself rather than once per translation cell
function quiet_chapter_markers(markup:string):string {
    return markup.replace(/#ch\((\d+)\)/g, '#ch_quiet($1)')
}
