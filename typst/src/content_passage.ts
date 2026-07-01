
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


// Generate heading show rules
function gen_heading_rules(passage:TypstPassage):string {
    if (!passage.show_headings) {
        return '#show heading: none'
    }

    // Style headings to match current CSS
    // Level 1 (= Title): major heading (ms, mr) — bold, slightly larger
    // Level 2 (== Section): section heading (s, s1-4, sr) — italic, 0.9em
    // Level 3 (=== Minor): minor heading (sp, qa, superscriptions) — italic, smaller
    // Wrap each heading body in a `block` so it isn't treated as a continuation
    // paragraph — otherwise the document's `first-line-indent` would indent it.
    return `#show heading.where(level: 1): it => {
    v(0.5em)
    block(text(weight: "bold", size: 1.1em, it.body))
    v(0.25em)
}
#show heading.where(level: 2): it => {
    v(0.5em)
    block(text(weight: "bold", style: "italic", size: 0.9em, it.body))
    v(0.25em)
}
#show heading.where(level: 3): it => {
    v(0.25em)
    block(text(style: "italic", size: 0.85em, it.body))
    v(0.15em)
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

    // Enumerate footnotes alphabetically (a, b, c, …aa, ab…) so each in-text call shows a
    // visible superscript letter marking the word/phrase the note refers to
    lines.push('#set footnote(numbering: "a")')

    // Footnote entry styling (the content at page bottom), prefixed with its matching mark so
    // readers can pair each note with its superscript call in the text
    lines.push(`#show footnote.entry: it => {
    super(numbering("a", ..counter(footnote).at(it.note.location())))
    h(1pt)
    it.note.body
}`)

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
