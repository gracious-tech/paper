
import {parse_unit} from './helpers.js'

import type {TypstRequest} from './types.js'


// Generate the document preamble: page setup, fonts, paragraph settings, footer
export function gen_preamble(request:TypstRequest):string {
    const {page, typography} = request

    // Calculate leading from line_height (Typst leading = gap between lines, not multiplier)
    const font = parse_unit(typography.font_size)
    const leading = `${((typography.line_height - 1) * font.num).toFixed(2)}${font.unit}`

    // Build font list
    const fonts = [typography.font_family, ...typography.font_fallbacks]
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

    // Build margin specification
    let margin:string
    if (page.margin_swap) {
        // Use inside/outside so Typst swaps on alternating pages
        margin = `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
            + `inside: ${page.margin_left}, outside: ${page.margin_right})`
    } else {
        margin = `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
            + `left: ${page.margin_left}, right: ${page.margin_right})`
    }

    // Page footer with page numbers (state-based visibility)
    const footer = request.show_pages
        ? `context align(center, text(font: "Noto Sans", size: 7pt,
            counter(page).display()))`
        : 'none'

    return `// Document setup
#set document(title: "${request.title.replace(/"/g, '\\"')}")
#set page(
    width: ${page.width},
    height: ${page.height},
    margin: ${margin},
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

// Footnote area styling
#set footnote.entry(separator: line(length: 30%, stroke: 0.2mm + rgb("#0003")))

// Default definitions for the consumer functions emitted by the USX→Typst converter.
// c, v and wj are (re)defined per passage based on options; the rest are styled here.
// Values approximate the Paratext USFM default stylesheet (see the converter for details).
${STYLE_DEFS}

// Words of Jesus function (plain by default; passages enable red when show_wj is on)
#let wj(body) = body
`
}


// Typst definitions for the poetry/list/character consumer functions emitted by the
// converter (#q, #qm, #li, #lim, #qc, #qr, #qd, #lh, #lf, #qac, #qs, #bk, #tl, #add, #sig).
// Leveled families take a level argument; the rest take just their content.
const STYLE_DEFS = `// Poetry — hanging indent that deepens with level
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
#let sig(c) = emph(c)`
