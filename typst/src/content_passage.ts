
import {LARGE_POETRY, LOTS_OF_POETRY, escape_typst} from './helpers.js'

import type {TypstPassage} from './types.js'


// Generate Typst markup for a Bible passage content item
export function gen_passage(passage:TypstPassage):string {
    const parts:string[] = []

    // Optional passage title
    if (passage.passage_title) {
        parts.push(`#align(center, text(weight: "bold", size: 1.2em,
            [${escape_typst(passage.passage_title)}]))`)
        parts.push('')
    }

    // Determine if we use multi-bible side-by-side grid (columns layout with 2+ bibles)
    const use_grid = passage.bibles.length > 1 && passage.multi_layout === 'columns'

    // Determine column count for single-bible layout
    // When using grid, don't also use text columns (would be confusing)
    const use_columns = !use_grid && resolve_columns(passage)

    // Build the scoped block with passage-specific function definitions and show rules
    const inner = gen_passage_inner(passage, use_grid, use_columns)

    // Wrap in a scoped block so settings don't leak to other content
    parts.push(`#[
${inner}
]`)

    return parts.join('\n')
}


// Resolve whether to use 2-column text layout
function resolve_columns(passage:TypstPassage):boolean {
    if (passage.columns === 1) {
        return false
    }
    if (passage.columns === 2) {
        return true
    }
    // Auto: use columns for large poetry books
    return LARGE_POETRY.includes(passage.book)
}


// Generate the inner content of a passage block (function defs, show rules, content)
function gen_passage_inner(
    passage:TypstPassage, use_grid:boolean, use_columns:boolean,
):string {
    const lines:string[] = []

    // Alias the built-in vertical-space function before `v` is redefined as the verse marker
    // (the converter emits `#v(N)` for verses, which would otherwise shadow Typst's `v()`)
    lines.push('#let vspace = v')

    // Chapter marker function
    lines.push(gen_chapter_def(passage))

    // Verse marker function
    lines.push(gen_verse_def(passage))

    // Words of Jesus function override (if showing)
    if (passage.show_woj) {
        lines.push('#let wj(body) = text(fill: red, body)')
    }

    // Heading show rules
    lines.push(gen_heading_rules(passage))

    // Footnote show rules
    lines.push(gen_footnote_rules(passage))

    // Disable first-line-indent for poetry-heavy books
    if (LOTS_OF_POETRY.includes(passage.book)) {
        lines.push('#set par(first-line-indent: 0em)')
    }

    // Render the content
    if (use_grid) {
        lines.push(gen_multi_bible_grid(passage))
    } else if (use_columns) {
        lines.push(`#columns(2, gutter: ${passage.column_gap})[`)
        lines.push(passage.bibles[0]!.content)
        lines.push(']')
    } else {
        lines.push(passage.bibles[0]!.content)
    }

    return lines.join('\n')
}


// Generate the #let c(n) function definition based on chapter style
function gen_chapter_def(passage:TypstPassage):string {
    if (!passage.show_chapters) {
        return '#let c(n) = []'
    }

    switch (passage.show_chapters_style) {
        case 'divider':
            // Centered divider with dashes, hidden for chapter 1
            // Matches current CSS: centered, 0.8em, normal weight, sans-serif
            return `#let c(n) = if n > 1 {
    vspace(1em)
    align(center, text(size: 0.8em, weight: "regular", font: "Noto Sans",
        [\u2014\u2014\u2014 #str(n) \u2014\u2014\u2014]))
    vspace(1em)
}`

        case 'float':
            // Large floating chapter number positioned to the left
            return `#let c(n) = {
    vspace(0.6em)
    place(dx: -0.75em, text(size: 2em, weight: "bold", str(n)))
}`

        case 'heading':
            // Chapter N as a heading
            return '#let c(n) = heading(level: 1, "Chapter " + str(n))'

        default:
            return '#let c(n) = []'
    }
}


// Generate the #let v(n) function definition for verse numbers
function gen_verse_def(passage:TypstPassage):string {
    if (!passage.show_verses) {
        return '#let v(n) = []'
    }
    // Superscript, small, gray, bold — matching current CSS
    return `#let v(n) = {
    h(2pt)
    text(size: 0.7em, fill: gray, weight: "bold", super(str(n)))
    h(2pt)
}`
}


// Generate heading show rules
function gen_heading_rules(passage:TypstPassage):string {
    if (!passage.show_headings) {
        return '#show heading: none'
    }

    // Style headings to match current CSS
    // Level 1 (= Title): major heading (ms, mr) — bold, slightly larger
    // Level 2 (== Section): section heading (s, s1-4, sr) — italic, 0.9em
    // Level 3 (=== Minor): minor heading (sp, qa, superscriptions) — italic, smaller
    return `#show heading.where(level: 1): it => {
    vspace(0.5em)
    text(weight: "bold", size: 1.1em, it.body)
    vspace(0.25em)
}
#show heading.where(level: 2): it => {
    vspace(0.5em)
    text(weight: "bold", style: "italic", size: 0.9em, it.body)
    vspace(0.25em)
}
#show heading.where(level: 3): it => {
    vspace(0.25em)
    text(style: "italic", size: 0.85em, it.body)
    vspace(0.15em)
}`
}


// Generate footnote show rules
function gen_footnote_rules(passage:TypstPassage):string {
    if (!passage.show_footnotes) {
        // Shadow the footnote function so notes are never registered. A `#show footnote: none`
        // rule only hides the in-text call — the entry and separator still render at page bottom
        // (and entry show rules can't reach the page footnote area from this scoped block).
        return '#let footnote(..args) = none'
    }

    const lines:string[] = []

    // Footnote entry styling (the content at page bottom)
    // NOTE leading is a `par` property, not a `text` argument
    lines.push(`#show footnote.entry: it => {
    set text(size: 0.8em)
    set par(leading: 1.2em)
    it.note.body
}`)

    // Hide or show the in-text call marker
    if (!passage.show_footnote_calls) {
        // Hide the superscript call in the text — use zero-width space as numbering
        lines.push('#set footnote(numbering: it => [])')
    }

    return lines.join('\n')
}


// Generate multi-bible side-by-side grid layout
function gen_multi_bible_grid(passage:TypstPassage):string {
    const cells = passage.bibles.map(bible => `[${bible.content}]`).join(',\n')
    return `#grid(
    columns: (1fr, 1fr),
    column-gutter: ${passage.column_gap},
    align: top,
    ${cells}
)`
}
