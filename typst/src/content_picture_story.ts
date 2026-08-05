
import {escape_typst_str} from 'typst-utils'

import {parse_unit} from './helpers.js'

import type {PageConfig, TypstPictureStory, TypstPictureStorySlide} from './types.js'


// Generate Typst markup for a picture story — a sequence of slides, one page each. Each slide
// pairs an optional image with an optional pre-rendered body (clean scripture prose or text). The
// image sits in the top or bottom half of the page (alternating per slide, decided at resolve
// time); an image-only slide fills the whole page and a body-only slide is centred. font_text2/
// font_fallbacks are only used when a slide has a second translation (body2) to stack below body.
export function gen_picture_story(
    story:TypstPictureStory, page:PageConfig, image_style:'borderless'|'padded',
    font_text2:string, font_fallbacks:string[],
):string {
    // Each slide is its own page; separate them with hard page breaks
    return story.slides
        .map(slide => gen_slide(
            slide, gen_slide_body(slide, font_text2, font_fallbacks), page, image_style))
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
    image_style:'borderless'|'padded',
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
    const image_top = slide.image_position === 'top'
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
