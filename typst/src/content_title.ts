
import {escape_typst_str} from 'typst-utils'

import {escape_typst, escape_svg_for_typst, parse_unit} from './helpers.js'

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

    // Vertical spacing before title (proportional to page height)
    const top_space = `${(page_h.num / 6).toFixed(2)}${page_h.unit}`
    const mid_space = `${(page_h.num / 5).toFixed(2)}${page_h.unit}`

    // Title text
    parts.push(`#align(center)[`)
    parts.push(`    #v(${top_space})`)
    parts.push(`    #text(`)
    parts.push(`        font: "${font_escaped}",`)
    parts.push(`        weight: 700,`)
    parts.push(`        size: 55pt,`)
    parts.push(`        fill: rgb("${color_text}"),`)
    parts.push(`    )[${escape_typst(title.title)}]`)

    // Subtitle
    parts.push(`    #v(0.5cm)`)
    parts.push(`    #text(`)
    parts.push(`        font: "${font_escaped}",`)
    parts.push(`        weight: 700,`)
    parts.push(`        size: 20pt,`)
    parts.push(`        fill: rgb("${color_text}"),`)
    parts.push(`    )[${escape_typst(title.subtitle)}]`)

    // Icon (recolored SVG, embedded as an image and scaled to a fraction of the page width,
    // adjusted by the user's size multiplier)
    if (title.icon) {
        const icon_w = `${(page_w.num / 4 * icon_size).toFixed(2)}${page_w.unit}`
        const icon_bytes = `bytes("${escape_svg_for_typst(title.icon)}")`
        parts.push(`    #v(${mid_space})`)
        parts.push(`    #image.decode(${icon_bytes}, width: ${icon_w})`)
    }

    parts.push(`]`)

    return parts.join('\n')
}
