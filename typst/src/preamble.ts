
import {escape_typst_str} from 'typst-utils'

import {parse_unit} from './helpers.js'

import type {TypstRequest} from './types.js'


// Optional page-geometry overrides for special documents — facing-pages compiles double the
// width with fixed margins and a per-half header/footer row (see generate_typst_facing)
export interface PreambleOverrides {
    width?:string
    margin?:string
    header?:string
    footer?:string
    binding?:'left'|'right'
}


// Build the combined page-number + running-heading row (a 3-cell left/center/right grid, the
// standard running-head layout) shown in whichever page slot (header/footer) the blueprint
// chose. Returns 'none' when neither feature is on. The returned expression must be evaluated
// inside a #context block by the caller — it reads state set up in generate.ts's per-item loop
// (running-active/running-book/running-chapter/running-side) via state(...).at(here())
function gen_page_furniture_row(request:TypstRequest):string {
    if (!request.running_pages && !request.running_headings) {
        return 'none'
    }

    // Page number cell. No font: override — inherits the document-wide #set text(font: (...))
    // below (font_text + its regular fallbacks), same as any other text. Size is 0.7em so the
    // running furniture tracks the user's body font_size instead of a frozen point size
    const number = request.running_pages
        ? 'text(size: 0.7em, counter(page).display())'
        : 'none'

    // Running heading cell — only shows once a passage is the active content item (title/
    // custom/lines/picture-story pages have no book/chapter to show)
    const heading = request.running_headings
        ? `if state("running-active", false).at(here()) {
            text(size: 0.7em, state("running-book", "").at(here()) + " "
                + str(state("running-chapter", 0).at(here())))
        } else { none }`
        : 'none'

    // The page number takes request.running_align; the running heading takes the other slot
    const outer = request.running_align === 'outer' ? number : heading
    const center = request.running_align === 'outer' ? heading : number

    return `{
        // Odd = recto/right by convention, matching the parity pdf_postprocess.ts already
        // encodes for blank-page insertion. running-side overrides this for half_blank
        // passages, whose physical side is fixed regardless of the Typst-internal page
        // counter (see process_faced in pdf_postprocess.ts)
        let side = state("running-side", none).at(here())
        let recto = if side != none { side == "right" }
            else { calc.odd(counter(page).at(here()).first()) }
        let outer_cell = align(if recto { right } else { left }, ${outer})
        let center_cell = align(center, ${center})
        grid(columns: (1fr, 1fr, 1fr), align: horizon,
            if recto { none } else { outer_cell },
            center_cell,
            if recto { outer_cell } else { none },
        )
    }`
}


// Generate the document preamble: page setup, fonts, paragraph settings, footer, and the
// consumer-function definitions emitted by the USX→Typst converter
export function gen_preamble(request:TypstRequest, overrides:PreambleOverrides = {}):string {
    const {page, typography, features} = request

    // Calculate leading from line_height. Typst's "leading" is only the *added* gap between
    // lines — the rest of a line's advance normally comes from each line's own content: the
    // font's ascent/descent metrics, and crucially the tallest run on the line. Paired with the
    // top-edge/bottom-edge: 0 show rules below, that content contribution is collapsed to zero,
    // so leading alone is the entire baseline-to-baseline advance. Two reasons this matters:
    //
    //   1. Uniform grid regardless of inline content. A verse number, a raised footnote marker
    //      (#super), a superscript, an inline drop of a taller fallback font — with metric-based
    //      spacing any of these makes its line taller than its neighbours, so paragraph lines
    //      visibly breathe unevenly wherever a verse or note falls. Zeroing the edges means
    //      nothing on the line can push it open: every line sits on the same rhythm. Typst has
    //      no baseline-grid feature, so a constant line-box height is the only way to get this.
    //   2. line_height behaves as a literal multiplier. font-metric ascent/descent is usually
    //      well under 1em, so `(line_height - 1) * font_size` (the naive formula) undershoots
    //      badly; here line_height * font_size *is* the whole line height, matching the UI.
    //
    // Tradeoff: the tallest-run contribution is what would otherwise give stacked-mark scripts
    // (Thai, Khmer, Devanagari, Vietnamese diacritics, ...) extra headroom automatically. With
    // it gone, that headroom has to come from a large enough line_height instead — a single
    // global value, so the grid stays uniform (see the line_height floor / default).
    const font = parse_unit(typography.font_size)
    const leading = `${(typography.line_height * font.num).toFixed(2)}${font.unit}`

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

    // Build margin specification (inside/outside so Typst swaps on alternating pages).
    // Typst's inside/outside swap follows the *physical* first page of this compile (always
    // "odd"), not the counter(page) value set below — so when a content item's true position
    // in the assembled book is even, the caller passes binding: 'right' to mirror it and keep
    // "inside" on the correct physical side (see generate_typst's start_page parity)
    const margin = overrides.margin
        ?? `(top: ${page.margin_top}, bottom: ${page.margin_bottom}, `
        + `inside: ${page.margin_left}, outside: ${page.margin_right})`
    const binding = overrides.binding ?? 'left'

    // Page number + running heading, combined into whichever slot (header/footer) the
    // blueprint chose — see gen_page_furniture_row
    const furniture_row = gen_page_furniture_row(request)

    const header = overrides.header
        ?? (request.running_position === 'header' && furniture_row !== 'none'
            ? `context {
    counter(footnote).update(0)
    ${furniture_row}
}`
            : 'context counter(footnote).update(0)')

    const footer = overrides.footer
        ?? (request.running_position === 'footer' && furniture_row !== 'none'
            ? `context ${furniture_row}`
            : 'none')

    // Chapter marker (#ch) — style depends on the chosen option. Every branch updates
    // running-chapter unconditionally (regardless of whether the style visually shows
    // anything), so the running heading keeps tracking chapters even when chapter numbers
    // are hidden entirely
    let chapter:string
    if (!features.show_chapters) {
        chapter = '#let ch(n) = state("running-chapter", 0).update(n)'
    } else if (features.show_chapters_style === 'divider') {
        // Centered divider with the number flanked by solid drawn rules (rather than dashes,
        // which can leave font-dependent gaps), hidden for chapter 1. Each rule is a fixed-width
        // box with its baseline raised so the line sits centred on the number rather than at the
        // text baseline. No font: override — see footer. The visual is factored into #ch_divider
        // so the bilingual columns layout can draw one divider across both translations at full
        // grid width rather than one inside each cell (see gen_multi_bible_grids)
        chapter = `#let ch_divider(n) = {
    v(0.5em)
    align(center, text(size: 0.8em, weight: "regular", {
        let rule = box(width: 2em, baseline: -0.28em, line(length: 100%, stroke: 0.5pt))
        [#rule #str(n) #rule]
    }))
    v(0.5em)
}
#let ch(n) = {
    state("running-chapter", 0).update(n)
    if n > 1 {
        ch_divider(n)
    }
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
    state("running-chapter", 0).update(n)
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
        chapter = `#let ch(n) = {
    state("running-chapter", 0).update(n)
    heading(level: 1, "Chapter " + str(n))
}`
    }

    // Quiet chapter marker — advances the running-chapter state without drawing anything. The
    // bilingual columns layout swaps the in-cell #ch for this so the marker isn't drawn once per
    // translation: the divider style draws a single divider at full grid width and the drop-cap
    // style keeps only the primary translation's margin numeral (see gen_multi_bible_grids in
    // content_passage.ts)
    chapter += '\n#let ch_quiet(n) = state("running-chapter", 0).update(n)'

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
    binding: ${binding},
    header: ${header},
    footer: ${footer},
    // Gap between the running header/footer and the body (eats into the margin)
    header-ascent: 3em,
    footer-descent: 3em,
)
#set text(font: (${fonts}), size: ${typography.font_size}, hyphenate: ${
        typography.hyphenate}${
        typography.text_color ? `, fill: rgb("${typography.text_color}")` : ''})
// spacing matches leading (rather than Typst's larger default) so a paragraph break reads the
// same as a wrapped line — indent alone marks a new paragraph, no added gap. A literal 0pt would
// make consecutive paragraphs overlap, since block spacing is additive on top of zero rather
// than replacing the line-height advance leading provides within a paragraph
#set par(
    leading: ${leading},
    spacing: ${leading},
    justify: ${justify},
    first-line-indent: (amount: 1.5em, all: false),
)
// Bring the list body (not the marker) to roughly the paragraph first-line indent. Typst only
// exposes indent (before the marker) and body-indent (marker to body), so the marker hangs in
// the indent space and indent is reduced to absorb the marker width + body-indent, leaving the
// text near 1.5em. Inter-item and outer spacing are pinned to leading so the list keeps the
// body-paragraph rhythm and still tracks the user's line_height setting
#set list(indent: 0.6em, spacing: ${leading})
#set enum(indent: 0.6em, spacing: ${leading})
#show list: set block(above: ${leading}, below: ${leading})
#show enum: set block(above: ${leading}, below: ${leading})
// Collapse every line's own height to zero so leading (above) is the whole baseline-to-baseline
// advance — see the long note by the leading calc for the full rationale. In short: Bible body
// text is dense with verse numbers and footnote markers, and with normal font-metric spacing
// each of those would make its line a little taller than the ones around it, so paragraph
// leading would visibly wobble line to line. Zeroing top-edge/bottom-edge means no glyph on a
// line — verse number, raised marker, tall fallback font — can push it open: uniform grid.
// Scoped (not global) so headings and the running header/footer keep Typst's metric-based
// spacing. list/enum/terms need their own rules — the par rule doesn't reach their item bodies,
// so without these their wrapped lines keep the font edges on top of leading and sit looser
#show par: set text(top-edge: 0pt, bottom-edge: 0pt)
#show list: set text(top-edge: 0pt, bottom-edge: 0pt)
#show enum: set text(top-edge: 0pt, bottom-edge: 0pt)
#show terms: set text(top-edge: 0pt, bottom-edge: 0pt)

// Heading font — applies document-wide to any heading (chapter markers, section headings)
#show heading: set text(font: "${escape_typst_str(typography.font_headings)}")

// Footnote area styling
#set footnote.entry(separator: line(length: 30%, stroke: 0.2mm + rgb("#000")))

// Consumer-function definitions emitted by the USX→Typst converter
${chapter}
${verse}
${wj}
// Poetry — a 1em grid: each level indents one more step. A wrapped ("turn") line hangs
// two steps, so it never lands on the next structural level's position and can't be
// mistaken for one — the standard print-Bible treatment. Relative to the line's own
// indent, so it stays modest on narrow columns unlike the old fixed deep runover.
// q_base/qm_base take a base offset that drops every level by that many steps; a
// mainly-poetry book re-binds q/qm to pass base: 1 (see gen_passage_inner) so a
// first-level line sits flush at the margin instead of always indented
#let q_base(n, c, base: 0) = pad(
    left: 1em * calc.max(n - base, 0),
    par(hanging-indent: 2em, c),
)
// Embedded poetry — one step deeper than the equivalent q level so it stays distinct
#let qm_base(n, c, base: 0) = pad(
    left: 1em * calc.max(n + 1 - base, 0),
    par(hanging-indent: 2em, c),
)
#let q(n, c) = q_base(n, c)
#let qm(n, c) = qm_base(n, c)
// List entry (USFM \li) — same 1em grid as poetry: one step per level, and a wrapped
// line hangs two steps so it can't be mistaken for a deeper-level item
#let li(n, c) = pad(
    left: 1em * n,
    par(hanging-indent: 2em, c),
)
// Embedded list entry — one step deeper than the equivalent li level
#let lim(n, c) = pad(
    left: 1em * (n + 1),
    par(hanging-indent: 2em, c),
)
// Stanza break (USFM \b) — a deliberate blank line between poetry stanzas
#let b() = v(1em)
// Non-leveled wrapped paragraphs
#let qc(c) = align(center, c)
#let qr(c) = align(right, c)
// Poetic descriptor (USFM \qd) — a rare Hebrew musical postscript; just italicise it
// like the other paratextual notes (\qs etc.), no bespoke indent for now
#let qd(c) = emph(c)
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
