
import {escape_typst_str} from 'typst-utils'

import {parse_unit} from './helpers.js'

import type {TypstRequest} from './types.js'


// Optional page-geometry overrides for special documents — facing-pages compiles double the
// width with fixed margins and a per-half page-number footer (see generate_typst_facing)
export interface PreambleOverrides {
    width?:string
    margin?:string
    footer?:string
}


// Generate the document preamble: page setup, fonts, paragraph settings, footer, and the
// consumer-function definitions emitted by the USX→Typst converter
export function gen_preamble(request:TypstRequest, overrides:PreambleOverrides = {}):string {
    const {page, typography, features} = request

    // Calculate leading from line_height (Typst leading = gap between lines, not multiplier)
    const font = parse_unit(typography.font_size)
    const leading = `${((typography.line_height - 1) * font.num).toFixed(2)}${font.unit}`

    // Build font list
    const fonts = [typography.font_text, ...typography.font_fallbacks]
        .map(f => `"${f}"`)
        .join(', ')

    // Determine justification
    let justify = 'false'
    if (typography.justify === true) {
        justify = 'true'
    } else if (typography.justify === null) {
        // Auto: justify if page is wide enough (heuristic: > 80mm text width)
        justify = 'true'
    }

    // Build margin specification (inside/outside so Typst swaps on alternating pages)
    const margin = overrides.margin
        ?? `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
        + `inside: ${page.margin_left}, outside: ${page.margin_right})`

    // Page footer with page numbers (state-based visibility). No font: override — inherits the
    // document-wide #set text(font: (...)) below (font_text + its regular fallbacks), same as
    // any other text, rather than a separate fixed style
    const footer = overrides.footer
        ?? (request.show_pages
            ? `context align(center, text(size: 7pt,
            counter(page).display()))`
            : 'none')

    // Chapter marker (#ch) — style depends on the chosen option
    let chapter:string
    if (!features.show_chapters) {
        chapter = '#let ch(n) = []'
    } else if (features.show_chapters_style === 'divider') {
        // Centered divider with dashes, hidden for chapter 1. No font: override — see footer
        chapter = `#let ch(n) = if n > 1 {
    v(1em)
    align(center, text(size: 0.8em, weight: "regular",
        [——— #str(n) ———]))
    v(1em)
}`
    } else if (features.show_chapters_style === 'float') {
        // Large floating chapter number positioned to the left
        chapter = `#let ch(n) = {
    v(0.6em)
    place(dx: -0.75em, text(size: 2em, weight: "bold", str(n)))
}`
    } else {
        // 'heading' — Chapter N as a heading (font comes from the document-wide heading
        // show rule below, same as any other heading)
        chapter = '#let ch(n) = heading(level: 1, "Chapter " + str(n))'
    }

    // Verse marker (#vn) — superscript bold number glued to the next word with a narrow
    // no-break space (U+202F) so it can't be stranded at a line end when the text wraps
    const verse = features.show_verses
        ? `#let vn(n) = [#text(weight: "bold", super(str(n)))#sym.space.nobreak.narrow]`
        : '#let vn(n) = []'

    // Words of Jesus (#wj) — plain unless color/bold/italic styling is enabled
    const wj_styles:string[] = []
    if (features.show_wj) {
        if (features.show_wj_color) {
            wj_styles.push(`fill: rgb("${features.show_wj_color}")`)
        }
        if (features.show_wj_bold) {
            wj_styles.push('weight: "bold"')
        }
        if (features.show_wj_italic) {
            wj_styles.push('style: "italic"')
        }
    }
    const wj = wj_styles.length
        ? `#let wj(body) = text(${wj_styles.join(', ')}, body)`
        : '#let wj(body) = body'

    // The whole preamble, with the computed values substituted in. The chapter/verse/wj
    // markers vary with the feature options above; the poetry (#q, #qm), list (#li, #lim) and
    // character styles (#qc, #qr, #qd, #lh, #lf, #qac, #qs, #bk, #tl, #add, #sig) are static
    // and approximate the Paratext USFM default stylesheet.
    return `

// Document setup
#set document(title: "${escape_typst_str(request.title)}")
#set page(
    width: ${overrides.width ?? page.width},
    height: ${page.height},
    margin: ${margin},
    header: context counter(footnote).update(0),
    footer: ${footer},
    footer-descent: 20%,
)
#set text(font: (${fonts}), size: ${typography.font_size}${
        typography.text_color ? `, fill: rgb("${typography.text_color}")` : ''})
#set par(
    leading: ${leading},
    justify: ${justify},
    first-line-indent: (amount: 1.5em, all: false),
)

// Heading font — applies document-wide to any heading (chapter markers, section headings)
#show heading: set text(font: "${escape_typst_str(typography.font_headings)}")

// Footnote area styling
#set footnote.entry(separator: line(length: 30%, stroke: 0.2mm + rgb("#000")))

// Consumer-function definitions emitted by the USX→Typst converter
${chapter}
${verse}
${wj}
// Poetry — hanging indent that deepens with level
#let q(n, c) = pad(
    left: 0.25in + (n - 1) * 0.125in,
    par(hanging-indent: 0.75in - (0.25in + (n - 1) * 0.125in), c),
)
// Embedded poetry
#let qm(n, c) = pad(
    left: 0.25in + (n - 1) * 0.25in,
    par(hanging-indent: 1in - (0.25in + (n - 1) * 0.25in), c),
)
// List entry — bullet on the first line
#let li(n, c) = pad(
    left: (n - 1) * 0.25in + 0.125in,
    par(hanging-indent: 0.375in, [• #c]),
)
// Embedded list entry
#let lim(n, c) = pad(
    left: (n - 1) * 0.25in + 0.375in,
    par(hanging-indent: 0.375in, [• #c]),
)
// Non-leveled wrapped paragraphs
#let qc(c) = align(center, c)
#let qr(c) = align(right, c)
#let qd(c) = pad(left: 0.25in, emph(c))
#let lh(c) = strong(c)
#let lf(c) = c
// Character styles with no native Typst equivalent
#let qac(c) = emph(c)
#let qs(c) = emph(c)
#let bk(c) = emph(c)
#let tl(c) = emph(c)
#let add(c) = emph(c)
#let sig(c) = emph(c)
// Original-language word glosses used by study notes — no special styling for now
#let greek(c) = c
#let hebrew(c) = c
#let aramaic(c) = c
#let latin(c) = c
// Study note footnote — hidden in-text marker and entry mark (verse numbers are the reference).
// Defined here (global scope) so it keeps working even when a passage scope later shadows
// #footnote to disable regular translator footnotes — closures capture this binding, not that one.
#let studynote(body) = footnote(numbering: n => [], body)

`.trim()}
