
import {escape_typst_str} from 'typst-utils'

import {escape_typst, escape_svg_for_typst, parse_unit, to_mm} from './helpers.js'

import type {PageConfig, TypstTitlePage} from './types.js'


// Generate Typst markup for a decorative title page. Styling (font/frame/colors/text + icon
// size) is document-wide (see TitlepageConfig on TypstRequest) so it's passed in explicitly
// rather than read off the item, which only carries its own text/icon content
export function gen_title(
    title:TypstTitlePage, page:PageConfig,
    font:string, frame_svg:string|null, color_text:string, color_frame:string,
    text_size = 1, icon_size = 1,
):string {
    const parts:string[] = []
    const font_escaped = escape_typst_str(font)

    const page_w = parse_unit(page.width)
    const page_h = parse_unit(page.height)
    const pattern_w = `${(page_w.num / 3).toFixed(2)}${page_w.unit}`

    // SVG corner patterns (one SVG mirrored to 4 corners)
    if (frame_svg) {
        // Replace default color in SVG with the user's frame color
        const svg = frame_svg.replace(/#000000/g, color_frame)
        const svg_bytes = `bytes("${escape_svg_for_typst(svg)}")`

        parts.push(`// Corner patterns`)
        parts.push(`#place(top + left, image.decode(${svg_bytes}, width: ${pattern_w}))`)
        parts.push(`#place(top + right, scale(x: -100%,`
            + ` image.decode(${svg_bytes}, width: ${pattern_w})))`)
        parts.push(`#place(bottom + left, scale(y: -100%,`
            + ` image.decode(${svg_bytes}, width: ${pattern_w})))`)
        parts.push(`#place(bottom + right, scale(x: -100%, y: -100%,`
            + ` image.decode(${svg_bytes}, width: ${pattern_w})))`)
        parts.push('')
    }

    // Display type scaled to the trim, then by the user's text-size multiplier
    const page_h_mm = to_mm(page_h.num, page_h.unit)
    const title_pt = (page_h_mm / 210 * 30 * text_size).toFixed(1)
    const subtitle_pt = (page_h_mm / 210 * 15 * text_size).toFixed(1)
    const sub_gap = (Number(title_pt) * 1).toFixed(1)

    // Gap between the text group and the icon below it — a fixed fraction of the trim height so
    // it scales with the page rather than the font
    const icon_gap = `${(page_h.num * 0.06).toFixed(2)}${page_h.unit}`

    // Cap the text column at 2/3 of the trim width (and never wider than the live content area)
    // — a title page wants a more generous margin than the body text, so long titles wrap early
    // rather than running the full measure
    const page_w_mm = to_mm(page_w.num, page_w.unit)
    const margin_l = parse_unit(page.margin_left)
    const margin_r = parse_unit(page.margin_right)
    const content_w_mm = page_w_mm - to_mm(margin_l.num, margin_l.unit) - to_mm(margin_r.num, margin_r.unit)
    const text_w = `${Math.min(content_w_mm, page_w_mm * 2 / 3).toFixed(2)}mm`

    // Leading for the title/subtitle — fixed, deliberately independent of the user's body
    // line-height so a wrapped title always spaces the same regardless of design settings.
    // preamble.ts zeroes every paragraph's top-edge/bottom-edge document-wide, so `leading` is
    // the whole baseline-to-baseline advance here: 1.4em == 1.4x line height. `em` resolves per
    // line, so the title and (smaller) subtitle each get the same 1.4x spacing
    const title_leading = '1.4em'

    // A styled text run — title and subtitle differ only in size
    const text_run = (size:string, body:string):string[] => [
        `#text(`,
        `    font: "${font_escaped}",`,
        `    weight: 700,`,
        `    size: ${size}pt,`,
        `    fill: rgb("${color_text}"),`,
        `)[${escape_typst(body)}]`,
    ]

    // The title + subtitle column: centred text in a fixed-width block with its own leading.
    // Justification and hyphenation are always off here regardless of the document settings —
    // a centred title must never be stretched to the measure or broken across lines. Each of
    // the two lines is emitted only when it has text, so a missing title/subtitle leaves no
    // empty run (and no stray gap) to knock the group off centre
    const text_group = ():string[] => {
        const inner:string[] = [
            `#set par(leading: ${title_leading}, justify: false)`,
            `#set text(hyphenate: false)`,
            `#align(center)[`,
        ]
        if (title.title) {
            inner.push(...text_run(title_pt, title.title))
        }
        if (title.subtitle) {
            if (title.title) {
                inner.push(`#v(${sub_gap}pt)`)
            }
            inner.push(...text_run(subtitle_pt, title.subtitle))
        }
        inner.push(`]`)
        return [`#block(width: ${text_w})[`, ...inner, `]`]
    }

    // Title, subtitle and icon are one group, vertically centred on the page as a unit (the
    // full-height block gives horizon alignment the whole page to centre within). Every piece
    // is optional — an absent one contributes nothing, so whatever remains stays centred
    const group:string[] = []
    if (title.title || title.subtitle) {
        group.push(...text_group())
    }
    if (title.icon) {
        // Recolored SVG embedded as an image, scaled to a fraction of the page width by the
        // user's size multiplier
        const icon_w = `${(page_w.num / 4 * icon_size).toFixed(2)}${page_w.unit}`
        const icon_bytes = `bytes("${escape_svg_for_typst(title.icon)}")`
        if (group.length) {
            group.push(`#v(${icon_gap})`)
        }
        group.push(`#image.decode(${icon_bytes}, width: ${icon_w})`)
    }

    // Optical-centring nudge. preamble.ts collapses every paragraph's top edge to the baseline,
    // so the group's bounding box starts at the title's first baseline even though the caps rise
    // ~0.7em above it; the icon below sits in a true box. Horizon-centring that box leaves the
    // *visible* composition sitting high, so push the group down by about half the missing cap
    // overhang. Measured from whichever text line leads the group (none → no nudge).
    const lead_pt = title.title ? Number(title_pt) : (title.subtitle ? Number(subtitle_pt) : 0)
    const nudge = `${(lead_pt * 0.35).toFixed(1)}pt`

    parts.push(`#block(width: 100%, height: 100%, place(center + horizon, dy: ${nudge})[`)
    parts.push(...group)
    parts.push(`])`)

    return parts.join('\n')
}
