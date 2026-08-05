
import {escape_typst_str} from 'typst-utils'

import {parse_unit} from './helpers.js'

import type {PageConfig, TypstPictureStory, TypstPictureStorySlide} from './types.js'


// Number of rows (= slides) per page in the grid layout (2 columns × 4 rows)
const GRID_ROWS = 4


// Generate Typst markup for a picture story. Each slide pairs an optional image with an optional
// pre-rendered body (clean scripture prose or text). 'single' layout: one slide per page, the
// image in the top or bottom half; 'grid' layout: 4 slides per page, one per row, the image in
// the left or right cell. story_alternate switches the image side per slide (top/bottom or
// left/right) instead of always using the same side. font_text2/font_fallbacks are only used when
// a slide has a second translation (body2) to stack below body.
export function gen_picture_story(
    story:TypstPictureStory, page:PageConfig, image_style:'borderless'|'padded',
    story_layout:'single'|'grid', story_alternate:boolean,
    font_text2:string, font_fallbacks:string[],
):string {
    const bodies = story.slides.map(slide => gen_slide_body(slide, font_text2, font_fallbacks))
    if (story_layout === 'grid') {
        return gen_grid_pages(story.slides, bodies, page, image_style, story_alternate)
    }
    // Each slide is its own page; separate them with hard page breaks. Not alternating always
    // places the image on top; alternating flips it per slide (even = top, odd = bottom)
    return story.slides
        .map((slide, i) => gen_slide(
            slide, bodies[i]!, page, image_style,
            story_alternate && i % 2 !== 0 ? 'bottom' : 'top'))
        .join('\n\n#pagebreak()\n\n')
}


// Merge a slide's two translation bodies into one block, the second stacked below the first
// (scoped to the second translation's font) with a spacer between. Returns null when the slide
// has no body at all, so the caller's existing image-only/blank handling still applies.
function gen_slide_body(
    slide:TypstPictureStorySlide, font_text2:string, font_fallbacks:string[],
):string|null {
    if (!slide.body) {
        return null
    }
    if (!slide.body2) {
        return slide.body
    }
    const fonts2 = [font_text2, ...font_fallbacks].map(f => `"${escape_typst_str(f)}"`).join(', ')
    return `${slide.body}
#v(1em)
#[
#set text(font: (${fonts2}))
${slide.body2}
]`
}


// Render a single slide's page. The layout is built from a full-page-height reserving block plus
// absolutely-placed image/body regions, rather than stacked in-flow boxes — placed content can't
// be pushed onto extra pages by paragraph leading or inter-block spacing, so each slide stays
// exactly one page.
function gen_slide(
    slide:TypstPictureStorySlide, body:string|null, page:PageConfig,
    image_style:'borderless'|'padded', image_position:'top'|'bottom',
):string {
    // Full page height (for a borderless bleed) and half of it
    const page_h = parse_unit(page.height)
    const half_page = `${(page_h.num / 2).toFixed(2)}${page_h.unit}`
    // The content area (within the margins) and half of it — the region places are measured in
    const content_h = `${page.height} - ${page.margin_top} - ${page.margin_bottom}`
    const half_content = `(${content_h}) / 2`
    // An empty full-height block that makes the page fill exactly one page
    const reserve = `#block(width: 100%, height: ${content_h})`

    // No image: the body fills the page (vertically centred), or a blank page if there's no body
    if (!slide.image) {
        return body ? gen_centered(body, content_h) : reserve
    }

    const filename = escape_typst_str(slide.image.filename)

    // Image only: fill the whole page
    if (!body) {
        return `${reserve}\n${gen_full_image(filename, page, image_style, content_h)}`
    }

    // Image + body: the image takes the top or bottom half, the body the other half (clipped so it
    // can't overflow past the midline — the confirmed clip-to-half behaviour)
    const image_top = image_position === 'top'
    const image_place = gen_half_image(
        filename, page, image_style, image_top ? 'top' : 'bottom', half_content, half_page)
    // Body centred (both axes) within its half, clipped so it can't overflow past the midline
    const body_place = `#place(top + left, dy: ${image_top ? half_content : '0pt'},
    block(width: 100%, height: ${half_content}, clip: true, align(center + horizon, [
${body}
])))`
    return `${reserve}\n${image_place}\n${body_place}`
}


// Absolutely-placed image for one half of a slide. 'padded' keeps the image within the margins
// (placed in its content-area half); 'borderless' bleeds it to the true page edge.
function gen_half_image(
    filename:string, page:PageConfig, image_style:'borderless'|'padded',
    which:'top'|'bottom', half_content:string, half_page:string,
):string {
    if (image_style === 'padded') {
        const dy = which === 'top' ? '0pt' : half_content
        return `#place(top + left, dy: ${dy},
    block(width: 100%, height: ${half_content}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "cover")))`
    }
    // Borderless: bleed to the page edge (offset out past the margins by the margin amount)
    return which === 'top'
        ? `#place(top + left, dx: -${page.margin_left}, dy: -${page.margin_top},
    image("${filename}", width: ${page.width}, height: ${half_page}, fit: "cover"))`
        : `#place(bottom + left, dx: -${page.margin_left}, dy: ${page.margin_bottom},
    image("${filename}", width: ${page.width}, height: ${half_page}, fit: "cover"))`
}


// Absolutely-placed full-page image for an image-only slide
function gen_full_image(
    filename:string, page:PageConfig, image_style:'borderless'|'padded', content_h:string,
):string {
    if (image_style === 'padded') {
        return `#place(top + left,
    block(width: 100%, height: ${content_h}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "cover")))`
    }
    // Borderless: bleeds to every page edge
    return `#place(top + left, dx: -${page.margin_left}, dy: -${page.margin_top},
    image("${filename}", width: ${page.width}, height: ${page.height}, fit: "cover"))`
}


// A body-only slide: centre the content on the page (both axes). Mirrors gen_custom's approach —
// measure the body and, if it fits, pin it to a full-height block so it centres; otherwise let it
// flow normally (horizontally centred, top-aligned) so it breaks across pages rather than clipping
function gen_centered(body:string, content_h:string):string {
    return `#layout(size => context {
    let body = [
${body}
    ]
    let content_height = measure(box(width: size.width, body)).height
    if content_height <= size.height {
        block(width: 100%, height: ${content_h}, align(center + horizon, body))
    } else {
        align(center, body)
    }
})`
}


// Grid layout: slides chunked GRID_ROWS at a time, each chunk its own page of stacked rows (2
// columns — one row per slide, image in one cell and body in the other). Uses the same
// full-height-reserving-block approach as gen_slide so each page of rows can't grow past one page
function gen_grid_pages(
    slides:TypstPictureStorySlide[], bodies:(string|null)[], page:PageConfig,
    image_style:'borderless'|'padded', story_alternate:boolean,
):string {
    const content_w = `${page.width} - ${page.margin_left} - ${page.margin_right}`
    const content_h = `${page.height} - ${page.margin_top} - ${page.margin_bottom}`
    const cell_w = `((${content_w}) / 2)`
    const cell_h = `((${content_h}) / ${GRID_ROWS})`
    const reserve = `#block(width: 100%, height: ${content_h})`

    const pages:string[] = []
    for (let start = 0; start < slides.length; start += GRID_ROWS) {
        const rows = slides.slice(start, start + GRID_ROWS).map((slide, row) => {
            // Not alternating always puts the image on the left; alternating flips it per row,
            // globally across the whole story (not restarting each page)
            const image_left = !story_alternate || (start + row) % 2 === 0
            return gen_grid_row(
                slide, bodies[start + row] ?? null, row, image_left, page, image_style,
                cell_w, cell_h, content_w)
        })
        pages.push(`${reserve}\n${rows.join('\n')}`)
    }
    return pages.join('\n\n#pagebreak()\n\n')
}


// One row of the grid: a slide's image and body side by side, or spanning the full row width when
// the slide is missing one of them (mirrors gen_slide's image-only/body-only/blank handling)
function gen_grid_row(
    slide:TypstPictureStorySlide, body:string|null, row:number, image_left:boolean,
    page:PageConfig, image_style:'borderless'|'padded',
    cell_w:string, cell_h:string, content_w:string,
):string {
    const dy = `(${cell_h}) * ${row}`
    const is_top = row === 0
    const is_bottom = row === GRID_ROWS - 1

    // No image: the body (if any) spans the full row width, centred; blank row otherwise
    if (!slide.image) {
        return body ? gen_grid_text(body, '0pt', dy, content_w, cell_h, '0pt') : ''
    }

    const filename = escape_typst_str(slide.image.filename)

    // Image only: fills the whole row, bleeding both the left and right page edge
    if (!body) {
        return gen_grid_cell_image(
            filename, page, image_style, '0pt', dy, content_w, cell_h, true, true, is_top,
            is_bottom)
    }

    // Image + body: split the row into image/text cells, on whichever side image_left picks. The
    // text's edge touching the image gets inset by that side's page margin, so it isn't flush
    // against the image and reads with the same breathing room as the page's own margins
    const image_dx = image_left ? '0pt' : cell_w
    const text_dx = image_left ? cell_w : '0pt'
    const image_place = gen_grid_cell_image(
        filename, page, image_style, image_dx, dy, cell_w, cell_h, image_left, !image_left,
        is_top, is_bottom)
    const text_inset = image_left
        ? `(left: ${page.margin_left})`
        : `(right: ${page.margin_right})`
    const text_place = gen_grid_text(body, text_dx, dy, cell_w, cell_h, text_inset)
    return `${image_place}\n${text_place}`
}


// A text cell, centred (both axes) and clipped to its cell bounds. inset (a Typst inset value —
// a length, or a `(left: ..)`/`(right: ..)` dictionary) pads the edge touching the image, if any
function gen_grid_text(
    body:string, dx:string, dy:string, width:string, height:string, inset:string,
):string {
    return `#place(top + left, dx: ${dx}, dy: ${dy},
    block(width: ${width}, height: ${height}, clip: true, inset: ${inset},
        align(center + horizon, [
${body}
])))`
}


// Absolutely-placed image for one cell of the grid. 'padded' keeps the image within its cell;
// 'borderless' bleeds past the margin on any edge of the cell that's also a true page edge — the
// left and/or right edge of the cell that touches the page side (an image spanning the full row
// width bleeds both), and/or the top/bottom edge of the row when it's the first/last on the page
function gen_grid_cell_image(
    filename:string, page:PageConfig, image_style:'borderless'|'padded',
    dx:string, dy:string, width:string, height:string,
    bleed_left:boolean, bleed_right:boolean, is_top:boolean, is_bottom:boolean,
):string {
    if (image_style === 'padded') {
        return `#place(top + left, dx: ${dx}, dy: ${dy},
    block(width: ${width}, height: ${height}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "cover")))`
    }
    let bleed_dx = dx
    let bleed_w = width
    if (bleed_left) {
        bleed_dx = `-${page.margin_left}`
        bleed_w = `(${bleed_w}) + (${page.margin_left})`
    }
    if (bleed_right) {
        bleed_w = `(${bleed_w}) + (${page.margin_right})`
    }
    let bleed_dy = dy
    let bleed_h = height
    if (is_top) {
        bleed_dy = `-${page.margin_top}`
        bleed_h = `(${bleed_h}) + (${page.margin_top})`
    }
    if (is_bottom) {
        bleed_h = `(${bleed_h}) + (${page.margin_bottom})`
    }
    return `#place(top + left, dx: ${bleed_dx}, dy: ${bleed_dy},
    image("${filename}", width: ${bleed_w}, height: ${bleed_h}, fit: "cover"))`
}
