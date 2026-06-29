
import {escape_typst, parse_unit} from './helpers.js'

import type {PageConfig, TypstTitlePage} from './types.js'


// Generate Typst markup for a decorative title page
export function gen_title(title:TypstTitlePage, page:PageConfig):string {
    const parts:string[] = []

    const page_w = parse_unit(page.width)
    const page_h = parse_unit(page.height)
    const pattern_w = `${(page_w.num / 3).toFixed(2)}${page_w.unit}`

    // SVG corner patterns (one SVG mirrored to 4 corners)
    if (title.pattern_svg) {
        // Replace default color in SVG with the user's secondary color
        const svg = title.pattern_svg.replace(/#000000/g, title.color_secondary)
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
    parts.push(`        font: "Dancing Script",`)
    parts.push(`        weight: 700,`)
    parts.push(`        size: 55pt,`)
    parts.push(`        fill: rgb("${title.color_primary}"),`)
    parts.push(`    )[${escape_typst(title.title)}]`)

    // Subtitle
    parts.push(`    #v(0.5cm)`)
    parts.push(`    #text(`)
    parts.push(`        font: "Dancing Script",`)
    parts.push(`        weight: 700,`)
    parts.push(`        size: 20pt,`)
    parts.push(`        fill: rgb("${title.color_primary}"),`)
    parts.push(`    )[${escape_typst(title.subtitle)}]`)

    // Icon (emoji)
    if (title.icon) {
        const icon_size = `${(page_h.num / 4).toFixed(2)}${page_h.unit}`
        parts.push(`    #v(${mid_space})`)
        parts.push(`    #text(`)
        parts.push(`        font: "Noto Emoji",`)
        parts.push(`        weight: 300,`)
        parts.push(`        size: ${icon_size},`)
        parts.push(`        fill: rgb("${title.color_secondary}"),`)
        parts.push(`    )[${title.icon}]`)
    }

    parts.push(`]`)

    return parts.join('\n')
}


// Escape an SVG string for embedding in Typst bytes() literal
function escape_svg_for_typst(svg:string):string {
    // Typst bytes("...") accepts a string that is encoded to UTF-8 bytes
    // Need to escape backslashes and double quotes
    return svg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
