
import {escape_typst_str} from 'typst-utils'

import {escape_typst, escape_svg_for_typst, parse_unit, to_mm} from './helpers.js'

import type {PageConfig, TypstTitlePage} from './types.js'


// Generate Typst markup for a decorative title page. Styling (font/frame/colors/icon size) is
// document-wide (see TitlepageConfig on TypstRequest) so it's passed in explicitly rather than
// read off the item, which only carries its own text/icon content
export function gen_title(
    title:TypstTitlePage, page:PageConfig,
    font:string, frame_svg:string|null, color_text:string, color_frame:string, icon_size:number,
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

    // Vertical spacing (proportional to page height) — only used by the icon layout below
    const top_space = `${(page_h.num / 6).toFixed(2)}${page_h.unit}`
    const mid_space = `${(page_h.num / 5).toFixed(2)}${page_h.unit}`

    // Display type scaled to the trim
    const page_h_mm = to_mm(page_h.num, page_h.unit)
    const title_pt = (page_h_mm / 210 * 30).toFixed(1)
    const subtitle_pt = (page_h_mm / 210 * 15).toFixed(1)
    const sub_gap = (Number(title_pt) * 1).toFixed(1)

    // A styled text run — title and subtitle differ only in size
    const text_run = (size:string, body:string):string[] => [
        `#text(`,
        `    font: "${font_escaped}",`,
        `    weight: 700,`,
        `    size: ${size}pt,`,
        `    fill: rgb("${color_text}"),`,
        `)[${escape_typst(body)}]`,
    ]

    if (title.icon) {
        // With an icon the text sits in the upper third and the icon hangs below it (recolored
        // SVG embedded as an image, scaled to a fraction of the page width by the user's size
        // multiplier)
        const icon_w = `${(page_w.num / 4 * icon_size).toFixed(2)}${page_w.unit}`
        const icon_bytes = `bytes("${escape_svg_for_typst(title.icon)}")`
        parts.push(`#align(center)[`)
        parts.push(`    #v(${top_space})`)
        parts.push(...text_run(title_pt, title.title))
        parts.push(`    #v(${sub_gap}pt)`)
        parts.push(...text_run(subtitle_pt, title.subtitle))
        parts.push(`    #v(${mid_space})`)
        parts.push(`    #image.decode(${icon_bytes}, width: ${icon_w})`)
        parts.push(`]`)
    } else {
        // No icon: centre the title + subtitle as one group on the page (full-height block so
        // horizon alignment has the whole page to centre within)
        parts.push(`#block(width: 100%, height: 100%, align(center + horizon)[`)
        parts.push(...text_run(title_pt, title.title))
        parts.push(`#v(${sub_gap}pt)`)
        parts.push(...text_run(subtitle_pt, title.subtitle))
        parts.push(`])`)
    }

    return parts.join('\n')
}
