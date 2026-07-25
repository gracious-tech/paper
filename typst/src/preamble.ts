
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
        // Centered divider with the number flanked by solid drawn rules (rather than dashes,
        // which can leave font-dependent gaps), hidden for chapter 1. Each rule is a fixed-width
        // box with its baseline raised so the line sits centred on the number rather than at the
        // text baseline. No font: override — see footer
        chapter = `#let ch(n) = if n > 1 {
    v(1em)
    align(center, text(size: 0.8em, weight: "regular", {
        let rule = box(width: 2em, baseline: -0.28em, line(length: 100%, stroke: 0.5pt))
        [#rule #str(n) #rule]
    }))
    v(1em)
}`
    } else if (features.show_chapters_style === 'float') {
        // Large numeral placed in the page's left margin, right-edge-aligned to the text (not
        // wrapped by it — Typst has no CSS-style float/text-wrap-around-a-shape, so reserving
        // exact line-space beside the numeral would need measuring the paragraph itself, which
        // #ch(n) doesn't have access to; it's just a marker inline in already-fetched markup).
        // Sized to a fixed em value regardless of digit count — multi-digit chapter numbers
        // (e.g. 150) rely on the margin being wide enough, same as any other marginal note.
        //
        // A zero-height block (rather than a bare place()) roots the numeral at #ch(n)'s own
        // position in the flow — non-floating place() anchors to its enclosing container's
        // origin, so repeated calls would otherwise all stack at the container's top edge.
        // `below: 0pt` means the marker adds no space beneath itself, so the block that follows
        // sits at the numeral's top edge; the block's default `above` spacing is kept so a new
        // chapter is still separated from the previous one. top-edge/bottom-edge "bounds"
        // tightens the frame to the digit's own glyph bounds, so place(top + ...) puts the top of
        // the numeral level with the top of the following line.
        //
        // The one thing that would still push the following content below the numeral is a
        // section heading's own leading space. So #ch flags the chapter as just-opened; a heading
        // that immediately follows reads the flag and drops its leading space to rise level with
        // the numeral (see gen_heading_rules in content_passage.ts). The flag is cleared by that
        // heading, or by the first verse marker (#vn) when a chapter opens straight into text, so
        // later mid-chapter headings keep their normal spacing.
        chapter = `#let ch(n) = {
    context {
        let num = text(size: 2.5em, weight: "bold", top-edge: "bounds", bottom-edge: "bounds",
            str(n))
        block(below: 0pt, height: 0pt,
            place(top + left, dx: -(measure(num).width + 0.3em), num))
    }
    state("ch-float-open", false).update(true)
}`
    } else {
        // 'heading' — Chapter N as a heading (font comes from the document-wide heading
        // show rule below, same as any other heading)
        chapter = '#let ch(n) = heading(level: 1, "Chapter " + str(n))'
    }

    // Verse marker (#vn) — superscript bold number glued to the next word with a narrow
    // no-break space (U+202F) so it can't be stranded at a line end when the text wraps
    const verse_mark = features.show_verses
        ? '[#text(weight: "bold", super(str(n)))#sym.space.nobreak.narrow]'
        : '[]'
    // Under the 'float' chapter style the first verse of a chapter also clears the just-opened
    // flag (see the #ch note above) so that a mid-chapter heading later on keeps its normal
    // leading; other styles keep the plain one-line definition
    const float_chapters = features.show_chapters && features.show_chapters_style === 'float'
    const verse = float_chapters
        ? `#let vn(n) = {
    state("ch-float-open", false).update(false)
    ${verse_mark}
}`
        : `#let vn(n) = ${verse_mark}`

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
// List entry
#let li(n, c) = pad(
    left: (n - 1) * 0.25in + 0.125in,
    par(hanging-indent: 0.375in, c),
)
// Embedded list entry
#let lim(n, c) = pad(
    left: (n - 1) * 0.25in + 0.375in,
    par(hanging-indent: 0.375in, c),
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
