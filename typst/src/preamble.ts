
import {escape_typst_str} from 'typst-utils'

import {CHAPTER_HEADING_LEVEL, TITLE_ON_PAGE, parse_unit, to_pt} from './helpers.js'

import type {TypstRequest} from './types.js'


// Size of the running page number / heading, relative to the body text. An em (not a fixed
// point size) so the furniture tracks the user's font_size. Books set their folio and running
// head near the body size — a step down keeps them out of the way of the text without
// shrinking them to a detail the eye has to hunt for
const RUNNING_FURNITURE_SIZE = '0.9em'


// What the running furniture shows before any of the compile's own content has updated the
// state it reads. A page's header/footer is laid out before that page's body, so state updates
// emitted at the top of the body aren't visible to it — and since every content item compiles
// as its own document (see compile_item in pdf_postprocess.ts), that is every item's opening
// page. So the values the item's own state reset would set are also handed to the states as
// their *initial* values, which is exactly "what the state reads as until an update precedes
// the reader" (see gen_running_states / running_seed in generate.ts)
export interface RunningSeed {
    // Whether the compile opens on content with a running heading at all (i.e. a passage)
    active:boolean
    // Book name and chapter the compile opens on
    book:string
    chapter:number
    // Fixed physical side of a half-blank passage, or null to fall back to live page parity
    side:'left'|'right'|null
}


// Seed for a compile opening on content that has no running heading of its own — the states'
// plain inert defaults
export const INERT_RUNNING_SEED:RunningSeed = {active: false, book: '', chapter: 0, side: null}


// The running-head states, each with the compile's seed as its initial value. Every read and
// write of these keys is built from here, so a key can never end up with two different initial
// values in one document
export function gen_running_states(seed:RunningSeed)
        :{active:string, book:string, chapter:string, side:string} {
    return {
        active: `state("running-active", ${seed.active})`,
        book: `state("running-book", "${escape_typst_str(seed.book)}")`,
        chapter: `state("running-chapter", ${seed.chapter})`,
        side: `state("running-side", ${seed.side ? `"${seed.side}"` : 'none'})`,
    }
}


// The running heading's text: the book and chapter the page is currently in, read from the
// state generate.ts's per-item loop keeps updated
export function gen_furniture_heading(seed:RunningSeed):string {
    const states = gen_running_states(seed)
    return `${states.book}.at(here()) + " " + str(${states.chapter}.at(here()))`
}


// Rules a furniture row sets for itself, whatever the document-wide settings say: each cell is
// only a third of the text width (a third of a half page in the facing layout), so a long
// localised book name plus chapter number can wrap inside one and must not be stretched or
// hyphenated. Interpolated at one indent level inside the row's own block
export const FURNITURE_RULES = `set par(justify: false)
        set text(hyphenate: false)`


// One cell of a running-furniture row, at the shared size — 'none' when that piece of furniture
// is switched off. No font: override, so it inherits the document-wide #set text(font: (...))
// like any other text. `gate` is the running-active state accessor (see gen_running_states),
// wrapping the cell in a check so title/custom/lines/picture-story pages carry no furniture at
// all (the page counter still advances, so later passage pages keep the right numbers); the
// facing layout passes null — such a compile is a single passage end to end, so every one of
// its pages is a passage page
export function gen_furniture_cell(enabled:boolean, expr:string, gate:string|null):string {
    if (!enabled) {
        return 'none'
    }
    const cell = `text(size: ${RUNNING_FURNITURE_SIZE}, ${expr})`
    return gate ? `if ${gate}.at(here()) { ${cell} } else { none }` : cell
}


// Wrap a built furniture row so a page carrying an inline passage title prints no furniture at
// all — neither running heading nor page number. A book opening is announced by its own title,
// and leaving the running head and folio off that page is standard book practice. `has_title`
// says whether the document being generated has such a title anywhere, so documents without one
// never pay for the per-page query (see TITLE_MARKER / TITLE_ON_PAGE in helpers.ts)
export function gen_title_page_gate(has_title:boolean, row:string):string {
    return has_title ? `if ${TITLE_ON_PAGE} { none } else { ${row} }` : row
}


// Assign the two furniture cells to their slots: the page number takes the blueprint's chosen
// alignment and the running heading takes whichever slot is left over
export function gen_furniture_slots(request:TypstRequest, number:string, heading:string)
        :{outer:string, center:string} {
    return request.running_align === 'outer'
        ? {outer: number, center: heading}
        : {outer: heading, center: number}
}


// Optional page-geometry overrides for special documents — facing-pages compiles double the
// width with fixed margins and a per-half header/footer row (see generate_typst_facing)
export interface PreambleOverrides {
    width?:string
    margin?:string
    header?:string
    footer?:string
    binding?:'left'|'right'
    // What the running-head states read as before this compile's content updates them — see
    // RunningSeed. Callers that render their own content list pass the seed of the item the
    // compile opens on; anything else gets the inert defaults
    seed?:RunningSeed
}


// Build the combined page-number + running-heading row (a 3-cell left/center/right grid, the
// standard running-head layout) shown in whichever page slot (header/footer) the blueprint
// chose. Returns 'none' when neither feature is on. The returned expression must be evaluated
// inside a #context block by the caller — it reads state set up in generate.ts's per-item loop
// (running-active/running-book/running-chapter/running-side) via state(...).at(here())
function gen_page_furniture_row(request:TypstRequest, seed:RunningSeed):string {
    if (!request.running_pages && !request.running_headings) {
        return 'none'
    }

    const states = gen_running_states(seed)

    // Both cells are gated on running-active, so they only show once a passage is the active
    // content item — title/custom/lines/picture-story pages have no book/chapter to show
    const number = gen_furniture_cell(request.running_pages, 'counter(page).display()',
        states.active)
    const heading = gen_furniture_cell(request.running_headings, gen_furniture_heading(seed),
        states.active)
    const {outer, center} = gen_furniture_slots(request, number, heading)

    // Whether any item in this document opens with an inline title, which suppresses the
    // furniture on the page it lands on — see gen_title_page_gate
    const has_title = request.content.some(
        item => item.type === 'passage' && item.passage_title)

    return `{
        ${FURNITURE_RULES}
        // Odd = recto/right by convention, matching the parity pdf_postprocess.ts already
        // encodes for blank-page insertion. running-side overrides this for half_blank
        // passages, whose physical side is fixed regardless of the Typst-internal page
        // counter (see process_faced in pdf_postprocess.ts)
        let side = ${states.side}.at(here())
        let recto = if side != none { side == "right" }
            else { calc.odd(counter(page).at(here()).first()) }
        let outer_cell = align(if recto { right } else { left }, ${outer})
        let center_cell = align(center, ${center})
        let row = grid(columns: (1fr, 1fr, 1fr), align: horizon,
            if recto { none } else { outer_cell },
            center_cell,
            if recto { outer_cell } else { none },
        )
        ${gen_title_page_gate(has_title, 'row')}
    }`
}


// The 'float' chapter numeral's design size by digit count, as a multiple of the body text. A
// longer number is a visually heavier block at the same type size, so each extra digit steps the
// size down — "150" then reads as the same weight of chapter opener as "5" rather than as three
// times the object. Indexed by digits; numbers past the last entry keep its size
const FLOAT_CHAPTER_SIZES = [2.2, 1.8, 1.5]
// The smallest it may shrink to when the margin can't hold the design size (see
// float_chapter_size) — much below this it stops reading as a chapter opener at all
const FLOAT_CHAPTER_MIN_SIZE = 1.2
// Approximate advance of one bold digit, as a fraction of its own font size. Deliberately a
// little generous — measured across bundled faces, bold figures run 0.51em (Libertinus Serif) to
// 0.70em (DejaVu Sans), with text serifs near 0.55em — so a fitted size errs towards fitting
const FLOAT_CHAPTER_DIGIT = 0.6
// Gap between the numeral and the text block, in body em — the same value #ch's own dx offsets by
const FLOAT_CHAPTER_GAP = 0.3
// Clearance kept between the numeral's outer edge and the trim, as a fraction of the margin.
// Proportional rather than a fixed em so the numeral reads as sitting *in* the margin at any page
// size, instead of grazing the page edge on the small trims where the margin is tightest
const FLOAT_CHAPTER_CLEARANCE = 0.15


// Size (in body em) of the 'float' style's margin numeral, from the document's longest chapter
// number (Psalm 150 is three digits; most books only reach two). Two rules, both taking the
// smaller answer: the design ladder above steps the size down per digit unconditionally, and the
// margin then caps it wherever even that wouldn't fit. The numeral hangs in whichever margin is on
// the left of the text block — the inside margin on a recto, the outside on a verso — so the fit
// is against the narrower of the two.
//
// Resolved once for the whole document rather than per marker: stepping the size at chapter 10 and
// again at 100 would put two sizes on the same spread and read as a rendering fault, not a design.
function float_chapter_size(request:TypstRequest):number {
    const pt = (value:string) => {
        const {num, unit} = parse_unit(value)
        return to_pt(num, unit)
    }
    const margin = Math.min(pt(request.page.margin_left), pt(request.page.margin_right))
    const available = margin * (1 - FLOAT_CHAPTER_CLEARANCE) / pt(request.typography.font_size)
        - FLOAT_CHAPTER_GAP
    const digits = String(Math.max(request.max_chapter, 1)).length
    const design = FLOAT_CHAPTER_SIZES[Math.min(digits, FLOAT_CHAPTER_SIZES.length) - 1]!
    const fitted = available / (digits * FLOAT_CHAPTER_DIGIT)
    return Math.max(FLOAT_CHAPTER_MIN_SIZE, Math.min(design, fitted))
}


// The 'divider' chapter visual (#ch_divider): the number flanked by solid drawn rules (rather
// than dashes, which can leave font-dependent gaps). Three paths draw it — the 'divider' style
// itself, the bilingual columns layout (one divider across both translations at full grid width
// rather than one inside each cell, see gen_multi_bible_grids) and the 'float' style's two-column
// fallback (see gen_ch_divider_binding). Each rule is a fixed-width box with its baseline raised
// so the line sits centred on the number rather than at the text baseline. No font: override, so
// it inherits the document-wide font like any other text.
//
// A single full-width block: width: 100% gives align(center) the text column to centre against,
// and sticky: true keeps the divider with the chapter's text so it can never be stranded at the
// foot of a page. Explicit v() around it gets trimmed — #ch(n) sits at a paragraph edge in the
// fetched markup — so the block's own margins are the spacing.
//
// above + below total two leadings, so the divider takes one line slot out of the baseline grid
// and the rhythm is unchanged. They're deliberately unequal though: every body line is a
// zero-height box on its baseline (see gen_preamble's leading calc), so the line
// *following* the divider hangs its whole ascent up into the gap beneath it, while the line above
// ends flat at its baseline. Equal margins therefore read as visibly top-heavy. Shifting up by
// half that imbalance — roughly half of a body ascent (~0.95em) less the divider's own cap-height
// (0.7 x 0.8em) — evens it out. A constant rather than a measured value: it's within ~0.05em
// across the font range, well below perception, and this runs once per chapter (1189x for a full
// Bible).
function gen_ch_divider(leading:string):string {
    return `#let ch_divider(n) = block(width: 100%, sticky: true,
    above: ${leading} - 0.2em, below: ${leading} + 0.2em,
    align(center, text(size: 0.8em, weight: "regular", {
        let rule = box(width: 2em, baseline: -0.28em, line(length: 100%, stroke: 0.5pt))
        [#rule #str(n) #rule]
    })))`
}


// A #ch / #ch_tight pair (named `name` and `name`_tight) that draws the divider visual, hidden
// for chapter 1 — nothing precedes it there to divide from.
//
// The _tight variant is what the generator swaps in wherever a chapter opens straight into a
// section heading (see tighten_chapter_before_heading in content_passage.ts). The divider already
// leaves a full line's gap below itself and the heading's own leading space would stack on top of
// that, leaving the divider hugging the previous chapter's last line and adrift from the chapter
// it opens. Raising the "heading-tight" flag makes the heading drop that space and sit one line
// slot below the divider — exactly where the chapter's first line of text would have sat if there
// were no heading (see gen_heading_rules). The n > 1 test mirrors the divider's: chapter 1 draws
// nothing, so its heading has nothing to sit against and keeps its normal spacing
function gen_ch_divider_binding(name:string, chapter_state:string):string {
    return `#let ${name}(n, ..rest) = {
    ${chapter_state}.update(n)
    if n > 1 {
        ch_divider(n)
    }
}
#let ${name}_tight(n, ..rest) = {
    ${name}(n)
    if n > 1 {
        state("heading-tight", false).update(true)
    }
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

    // Determine justification. The blueprint's setting is NOT the final word — it is resolved
    // per content item (see item_justifies in generate.ts, which owns the decision): only
    // passages and custom pages can ever be justified, and 'auto' (null) additionally opts out
    // of any measure too narrow to justify well. This rule is the justified-at-full-measure
    // answer, which is what every item wanting justification needs, so items only override it
    // where they turn justification back off. Also what the paths rendering no item list of
    // their own — facing-page passages, standalone blank/lines pages — end up using.
    const justify = typography.justify === false ? 'false' : 'true'

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
    const seed = overrides.seed ?? INERT_RUNNING_SEED
    const running = gen_running_states(seed)
    const furniture_row = gen_page_furniture_row(request, seed)

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
        chapter = `#let ch(n, ..rest) = ${running.chapter}.update(n)`
    } else if (features.show_chapters_style === 'divider') {
        chapter = `${gen_ch_divider(leading)}\n${gen_ch_divider_binding('ch', running.chapter)}`
    } else if (features.show_chapters_style === 'float') {
        // Large numeral placed in the page's left margin, right-edge-aligned to the text (not
        // wrapped by it — Typst has no CSS-style float/text-wrap-around-a-shape, so reserving
        // exact line-space beside the numeral would need measuring the paragraph itself, which
        // #ch(n) doesn't have access to; it's just a marker inline in already-fetched markup).
        // The size is one value for the whole document, fitted to the margin and the longest
        // chapter number the document reaches (see float_chapter_size).
        //
        // A zero-height block (rather than a bare place()) roots the numeral at #ch(n)'s own
        // position in the flow — non-floating place() anchors to its enclosing container's
        // origin, so repeated calls would otherwise all stack at the container's top edge.
        // `below: 0pt` means the marker adds no space beneath itself, so the block that follows
        // sits at the numeral's top edge; the block's default `above` spacing is kept so a new
        // chapter is still separated from the previous one. top-edge/bottom-edge "bounds"
        // tightens the frame to the digit's own glyph bounds, so place(top + ...) puts the top of
        // the numeral level with the top of the following line. `sticky: true` keeps it with what
        // it opens — the block has no height of its own, so a page/column break falling right
        // after it would otherwise fit it at the foot of the page and start the chapter's text
        // overleaf, leaving a bare numeral under the previous chapter's last line.
        //
        // The one thing that would still push the following content below the numeral is a
        // section heading's own leading space. So #ch flags the chapter as just-opened; a heading
        // that immediately follows reads the flag and drops its leading space to rise level with
        // the numeral (see gen_heading_rules in content_passage.ts). The flag is cleared by that
        // heading, or by the first verse marker (#vn) when a chapter opens straight into text, so
        // later mid-chapter headings keep their normal spacing.
        const num_size = parseFloat(float_chapter_size(request).toFixed(2))
        chapter = `#let ch(n, ..rest) = {
    ${running.chapter}.update(n)
    context {
        let num = text(size: ${num_size}em, weight: "bold",
            top-edge: "bounds", bottom-edge: "bounds", str(n))
        block(below: 0pt, height: 0pt, sticky: true,
            place(top + left, dx: -(measure(num).width + ${FLOAT_CHAPTER_GAP}em), num))
    }
    state("ch-float-open", false).update(true)
}`
        // A two-column passage has no margin on the left of its text to hang a numeral in — only
        // the inter-column gutter, a few mm against a numeral several times wider, so the second
        // column's numeral would overprint the first column's text. Such passages re-bind #ch to
        // this divider pair instead, which needs no horizontal room of its own (see
        // gen_passage_inner in content_passage.ts)
        chapter += `\n${gen_ch_divider(leading)}`
            + `\n${gen_ch_divider_binding('ch_columns', running.chapter)}`
    } else {
        // 'heading' — Chapter N as a heading (font comes from the document-wide heading
        // show rule below, same as any other heading). It gets its own heading level so that
        // turning section headings off doesn't take chapter headings with it — the passage's
        // rules style this level and hide only the content's own levels (see gen_heading_rules)
        chapter = `#let ch(n, ..rest) = {
    ${running.chapter}.update(n)
    heading(level: ${CHAPTER_HEADING_LEVEL}, "Chapter " + str(n))
}`
    }

    // Quiet chapter marker — advances the running-chapter state without drawing anything. The
    // bilingual columns layout swaps the in-cell #ch for this so the marker isn't drawn once per
    // translation: the divider style draws a single divider at full grid width and the margin
    // number style keeps only the primary translation's numeral (see gen_multi_bible_grids in
    // content_passage.ts)
    chapter += `\n#let ch_quiet(n, ..rest) = ${running.chapter}.update(n)`

    // Chapter marker for a chapter that opens straight into a section heading — the generator
    // swaps #ch for it wherever the markup has one directly followed by a heading (see
    // tighten_chapter_before_heading in content_passage.ts). Only the divider visual has anything
    // extra to do there, and it defines its own alongside #ch (see gen_ch_divider_binding), so
    // every other style just aliases #ch_tight to #ch
    const divider_chapters = features.show_chapters && features.show_chapters_style === 'divider'
    if (!divider_chapters) {
        chapter += '\n#let ch_tight(n, ..rest) = ch(n)'
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
        ? `#let vn(n, ..rest) = {
    state("ch-float-open", false).update(false)
    ${verse_mark}
}`
        : `#let vn(n, ..rest) = ${verse_mark}`

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
        ? `#let wj(body, ..rest) = text(${wj_styles.join(', ')}, body)`
        : '#let wj(body, ..rest) = body'

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
    // Gap between the running header/footer and the body, as a share of the margin it sits in
    // (Typst's own default is 30%). Deliberately margin-relative rather than font-relative: an
    // em-based gap grows with the text size while the margin doesn't, so a large font would
    // push the running head off the top of the page
    header-ascent: 40%,
    footer-descent: 40%,
)
#set text(font: (${fonts}), size: ${typography.font_size}, lang: "${typography.lang}", hyphenate: ${
        typography.hyphenate}${
        typography.text_color ? `, fill: rgb("${typography.text_color}")` : ''})
// Widow/orphan/runt/hyphenation break penalties pinned to Typst's current defaults so a
// version bump can't silently repaginate every document. Deliberately not raised: print-Bible
// convention tolerates the occasional widow to keep justified columns full and balanced —
// aggressive avoidance in dense 2-column / bilingual-cell text just trades single lines for
// ragged page bottoms.
#set text(costs: (orphan: 100%, widow: 100%, runt: 100%, hyphenation: 100%))
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

// Underline sits on the font's own metric by default (offset: auto), which in serif faces like
// Crimson Pro runs tight enough to the baseline to read as touching the letters. A small explicit
// offset clears them in any font. Editor prose is the only thing that underlines anything (custom
// pages and picture-story text), so this is document-wide purely to cover both of those paths
#set underline(offset: 0.12em)

// Footnote area styling. Both translator footnotes and study notes land here (study notes are
// footnotes with a blank mark — see studynote below), so one size covers Blueprint.footnote_size
// for both. It has to be set here, in the preamble, and not in a passage's scoped block: the page
// resolves its footnote area against the style chain in force before any content is laid out, so
// a footnote.entry rule introduced after the first piece of content on the page is silently
// ignored (which is why the entry recipe in content_passage.ts has never taken effect)
#set footnote.entry(separator: line(length: 30%, stroke: 0.2mm + rgb("#000")))
#show footnote.entry: set text(size: ${typography.footnote_size})

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
#let q(n, c, ..rest) = q_base(n, c)
#let qm(n, c, ..rest) = qm_base(n, c)
// List entry (USFM \li) — same 1em grid as poetry: one step per level, and a wrapped
// line hangs two steps so it can't be mistaken for a deeper-level item
#let li(n, c, ..rest) = pad(
    left: 1em * n,
    par(hanging-indent: 2em, c),
)
// Embedded list entry — one step deeper than the equivalent li level
#let lim(n, c, ..rest) = pad(
    left: 1em * (n + 1),
    par(hanging-indent: 2em, c),
)
// Stanza break (USFM \b) — a deliberate blank line between poetry stanzas
#let b(..rest) = v(1em)
// Non-leveled wrapped paragraphs
#let qc(c, ..rest) = align(center, c)
#let qr(c, ..rest) = align(right, c)
// Poetic descriptor (USFM \qd) — a rare Hebrew musical postscript; just italicise it
// like the other paratextual notes (\qs etc.), no bespoke indent for now
#let qd(c, ..rest) = emph(c)
// Descriptive title (USFM \d) — a Psalm's Hebrew superscription (e.g. "A Psalm of David,
// to the tune of..."); italicised like the other paratextual notes above, no bespoke
// indent for now
#let d(c, ..rest) = emph(c)
#let lh(c, ..rest) = strong(c)
#let lf(c, ..rest) = c
// Character styles with no native Typst equivalent
#let qac(c, ..rest) = emph(c)
#let qs(c, ..rest) = emph(c)
#let bk(c, ..rest) = emph(c)
#let tl(c, ..rest) = emph(c)
#let add(c, ..rest) = emph(c)
#let sig(c, ..rest) = emph(c)
// Original-language word glosses used by study notes — no special styling for now
#let greek(c, ..rest) = c
#let hebrew(c, ..rest) = c
#let aramaic(c, ..rest) = c
#let latin(c, ..rest) = c
// Study note footnote — hidden in-text marker and entry mark (verse numbers are the reference).
// Defined here (global scope) so it keeps working even when a passage scope later shadows
// #footnote to disable regular translator footnotes — closures capture this binding, not that one.
#let studynote(body) = footnote(numbering: n => [], body)

`.trim()}
