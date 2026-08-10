
import {escape_typst_str} from 'typst-utils'

import {parse_unit} from './helpers.js'

import type {ImageStyle, PageConfig, TypstPictureStory, TypstPictureStorySlide} from './types.js'


// Number of rows (= slides) per page in the grid layout (2 columns × 4 rows)
const GRID_ROWS = 4

// Picture-story body text is sized dynamically (per slide) to read large, like a children's
// book, without knowing the trim size in advance or overflowing its box. FIT_TARGET_RATIO_* is
// the fraction of the available box height the fitted text should fill — since the search only
// ever accepts sizes at or under this, it doubles as the overflow guard (never more than this
// fraction of the box, so always comfortably inside it). Grid cells get a higher target than the
// single layout's half-page: a quarter-row cell reads as cramped-yet-still-mostly-empty at 50%,
// where a half-page has enough room that 50% already looks intentionally spacious. FIT_MAX_SIZE_
// RATIO caps how much larger than the normal body size the fitted text may grow, so a single
// short word in a large trim's half-page doesn't blow up to an absurd size. FIT_MIN_SIZE_RATIO is
// the search's floor — a grid cell is a quarter of a single-layout half-page, so a normal-length
// verse can need to shrink well below the normal body size to hit its target there, unlike the
// spacious single layout; searching down to this floor (rather than assuming the normal body size
// always already satisfies the target) is what keeps the search's result actually verified-safe
// instead of just asserted-safe. FIT_ITERATIONS is the binary-search step count — 8 halvings of a
// range this size converges to well under 0.1pt, far finer than visually matters
const FIT_TARGET_RATIO_SINGLE = 0.5
const FIT_TARGET_RATIO_GRID = 0.8
const FIT_MAX_SIZE_RATIO = 3
const FIT_MIN_SIZE_RATIO = 0.35
const FIT_ITERATIONS = 8
// Horizontal slack reserved on each side of the wrapped text (as a fraction of the fitted font
// size) so glyph overhang doesn't reach the outer clip: true box's edge — see gen_fit_body
const FIT_GUTTER_EM = 0.12


// Generate Typst markup for a picture story. Each slide pairs an optional image with an optional
// pre-rendered body (clean scripture prose or text). 'single' layout: one slide per page, the
// image in the top or bottom half; 'grid' layout: 4 slides per page, one per row, the image in
// the left or right cell. story_alternate switches the image side per slide (top/bottom or
// left/right) instead of always using the same side. line_height is the document's own
// Blueprint.line_height setting, applied here as a literal multiplier of the body's own
// (dynamically fit) font size rather than the normal (fixed) body font size — see gen_fit_body.
// font_size/font_text2/font_size2/font_fallbacks are the normal-text baselines a slide's body is
// scaled from/relative to — font_text2/font_size2 only matter when a slide has a second
// translation. Every slide in the story shares one Typst state key (story_key, see gen_fit_body)
// so they all end up rendered at the same font size — a fresh random key per call keeps multiple
// picture-story items in the same document from sharing state with each other
export function gen_picture_story(
    story:TypstPictureStory, page:PageConfig, image_style:ImageStyle,
    story_layout:'single'|'grid', story_alternate:boolean, line_height:number, font_size:string,
    font_text2:string, font_size2:string, font_fallbacks:string[],
):string {
    const story_key = `story-fit-${crypto.randomUUID()}`
    if (story_layout === 'grid') {
        return gen_grid_pages(
            story.slides, page, image_style, story_alternate, line_height, font_size, font_text2,
            font_size2, font_fallbacks, story_key)
    }
    // Each slide is its own page; separate them with hard page breaks. Not alternating always
    // places the image on top; alternating flips it per slide (even = top, odd = bottom)
    return story.slides
        .map((slide, i) => gen_slide(
            slide, page, image_style, story_alternate && i % 2 !== 0 ? 'bottom' : 'top',
            line_height, font_size, font_text2, font_size2, font_fallbacks, story_key))
        .join('\n\n#pagebreak()\n\n')
}


// Merge a slide's two translation bodies into one fixed-size block, the second stacked below the
// first (scoped to the second translation's font/size) with a spacer between. Used only where box
// height isn't tightly constrained (the single-layout body-only slide, via gen_centered) — the
// image+body cases use gen_fit_body instead, which sizes (rather than just stacks) both bodies
// together. Returns null when the slide has no body at all. `em` is relative to whatever text
// size is active at the use site, so leading scales correctly even though this fixed-size path
// and gen_fit_body's dynamically-searched size never share a single concrete size value
function gen_stack_body(
    body:string|null, body2:string|null, line_height:number, font_text2:string,
    font_size2:string, font_fallbacks:string[],
):string|null {
    if (!body) {
        return null
    }
    const leading = `${line_height}em`
    if (!body2) {
        return `#[\n#set par(leading: ${leading}, spacing: ${leading})\n${body}\n]`
    }
    const fonts2 = [font_text2, ...font_fallbacks].map(f => `"${escape_typst_str(f)}"`).join(', ')
    return `#[
#set par(leading: ${leading}, spacing: ${leading})
${body}
#v(1em)
#[
#set text(font: (${fonts2}), size: ${font_size2})
${body2}
]
]`
}


// Binary-search the largest text size (bounded to [font_size * FIT_MIN_SIZE_RATIO,
// font_size * FIT_MAX_SIZE_RATIO]) whose rendered height stays within target_ratio of the
// given box — so a slide's text reads large (children's-book style) while never exceeding
// target_ratio of its box, regardless of trim size, passage length, or whether a second
// translation is shown. target_ratio is passed in (rather than a shared constant) since a grid
// cell and a single-layout half-page read differently at the same fill fraction — see the
// FIT_TARGET_RATIO_* constants. The search starts from FIT_MIN_SIZE_RATIO (well below the normal
// body size, not the normal body size itself) so its result is always actually verified against
// the box rather than just assumed — a normal-length verse can need to shrink below the normal
// body size to hit the target in a tight box (a grid cell, say), and searching from an unverified
// starting point would silently return an unsafe size instead of a genuinely smaller-but-safe
// one. That locally-fitting size is then folded into story_key's shared state (the running
// minimum across every slide in the story so far/still to come — see gen_picture_story), and the
// slide actually renders at state(story_key).final(), the story-wide minimum: since every slide's
// own fitted size is by definition big enough for that slide, and the shared minimum can only be
// smaller-or-equal, it's guaranteed to still fit every slide even though they all end up sharing
// one consistent size. When body2 is given it's scaled and stacked together with body (sharing
// one search), scaled by the same ratio the user's font_size2/font_size settings already express,
// so the two translations' relative sizing is preserved rather than fit independently. avail_w/
// avail_h must be absolute Typst length expressions (not percentages) since #measure needs a
// concrete width
function gen_fit_body(
    body:string, body2:string|null, line_height:number, font_size:string, font_size2:string,
    font_text2:string, font_fallbacks:string[], avail_w:string, avail_h:string, story_key:string,
    target_ratio:number,
):string {
    const min_size = parse_unit(font_size).num
    const max_size = min_size * FIT_MAX_SIZE_RATIO
    const search_floor = min_size * FIT_MIN_SIZE_RATIO
    const ratio2 = body2 ? parse_unit(font_size2).num / min_size : 1
    const fonts2 = [font_text2, ...font_fallbacks].map(f => `"${escape_typst_str(f)}"`).join(', ')
    const body2_content = body2 ? `[\n${body2}\n]` : 'none'
    const leading = `${line_height}em`
    return `context {
    let body_content = [
${body}
    ]
    let body2_content = ${body2_content}
    let avail_w = ${avail_w}
    let target_h = (${avail_h}) * ${target_ratio}
    // Wraps text narrower than the full available width, scaled to the candidate size — glyph
    // ink (comma tails, italic slant, kerning) can extend past its nominal advance width, and at
    // the large sizes this fit targets that overhang is big enough for the outer clip: true box
    // to visibly slice a character in half. This gutter keeps lines clear of that edge; it's
    // recalculated per candidate size since the overhang scales with it
    let render(size) = block(width: avail_w - size * ${FIT_GUTTER_EM}, {
        set text(size: size)
        set par(leading: ${leading}, spacing: ${leading})
        body_content
        if body2_content != none {
            v(1em)
            set text(size: size * ${ratio2}, font: (${fonts2}))
            body2_content
        }
    })
    let lo = ${search_floor}pt
    let hi = ${max_size}pt
    for _ in range(${FIT_ITERATIONS}) {
        let mid = (lo + hi) / 2
        if measure(render(mid)).height <= target_h {
            lo = mid
        } else {
            hi = mid
        }
    }
    let story_size = state("${story_key}", ${max_size}pt)
    story_size.update(old => calc.min(old, lo))
    align(center + horizon, render(story_size.final()))
}`
}


// Render a single slide's page. The layout is built from a full-page-height reserving block plus
// absolutely-placed image/body regions, rather than stacked in-flow boxes — placed content can't
// be pushed onto extra pages by paragraph leading or inter-block spacing, so each slide stays
// exactly one page.
function gen_slide(
    slide:TypstPictureStorySlide, page:PageConfig, image_style:ImageStyle,
    image_position:'top'|'bottom', line_height:number, font_size:string, font_text2:string,
    font_size2:string, font_fallbacks:string[], story_key:string,
):string {
    // Full page height (for a borderless bleed) and half of it
    const page_h = parse_unit(page.height)
    const half_page = `${(page_h.num / 2).toFixed(2)}${page_h.unit}`
    // The content area (within the margins) and half of it — the region places are measured in
    const content_w = `(${page.width}) - (${page.margin_left}) - (${page.margin_right})`
    const content_h = `${page.height} - ${page.margin_top} - ${page.margin_bottom}`
    const half_content = `(${content_h}) / 2`
    // An empty full-height block that makes the page fill exactly one page
    const reserve = `#block(width: 100%, height: ${content_h})`

    // No image: the body fills the page (vertically centred), or a blank page if there's no body.
    // Kept at fixed (not fit-scaled) size — a body-only slide's box is the whole page, a much
    // larger and more length-variable area than the image+body split below, so it keeps the
    // existing fit-or-flow overflow protection instead
    if (!slide.image) {
        const body = gen_stack_body(
            slide.body, slide.body2, line_height, font_text2, font_size2, font_fallbacks)
        return body ? gen_centered(body, content_h) : reserve
    }

    const filename = escape_typst_str(slide.image.filename)

    // Image only: fill the whole page
    if (!slide.body) {
        return `${reserve}\n${gen_full_image(filename, page, image_style, content_h)}`
    }

    // Image + body: the image takes the top or bottom half, the body the other half, sized to
    // fill ~half that half's area (see gen_fit_body) and clipped as a last-resort overflow guard
    const image_top = image_position === 'top'
    const image_place = gen_half_image(
        filename, page, image_style, image_top ? 'top' : 'bottom', half_content, half_page)
    const fit = gen_fit_body(
        slide.body, slide.body2, line_height, font_size, font_size2, font_text2, font_fallbacks,
        content_w, half_content, story_key, FIT_TARGET_RATIO_SINGLE)
    const body_place = `#place(top + left, dy: ${image_top ? half_content : '0pt'},
    block(width: 100%, height: ${half_content}, clip: true, ${fit}))`
    return `${reserve}\n${image_place}\n${body_place}`
}


// Absolutely-placed image for one half of a slide. Padded (plain/painted/torn) keeps the image
// within the margins (placed in its content-area half); 'borderless' bleeds it to the true page
// edge. Painted/torn use fit: "contain" since the image arrives pre-masked with an irregular
// transparent edge (see gen_passage_image)
function gen_half_image(
    filename:string, page:PageConfig, image_style:ImageStyle,
    which:'top'|'bottom', half_content:string, half_page:string,
):string {
    if (image_style !== 'borderless') {
        const fit = image_style === 'padded' ? 'cover' : 'contain'
        const dy = which === 'top' ? '0pt' : half_content
        return `#place(top + left, dy: ${dy},
    block(width: 100%, height: ${half_content}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "${fit}")))`
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
    filename:string, page:PageConfig, image_style:ImageStyle, content_h:string,
):string {
    if (image_style !== 'borderless') {
        const fit = image_style === 'padded' ? 'cover' : 'contain'
        return `#place(top + left,
    block(width: 100%, height: ${content_h}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "${fit}")))`
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
    slides:TypstPictureStorySlide[], page:PageConfig, image_style:ImageStyle,
    story_alternate:boolean, line_height:number, font_size:string, font_text2:string,
    font_size2:string, font_fallbacks:string[], story_key:string,
):string {
    const content_w = `(${page.width}) - (${page.margin_left}) - (${page.margin_right})`
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
                slide, row, image_left, page, image_style, cell_w, cell_h, content_w, line_height,
                font_size, font_text2, font_size2, font_fallbacks, story_key)
        })
        pages.push(`${reserve}\n${rows.join('\n')}`)
    }
    return pages.join('\n\n#pagebreak()\n\n')
}


// One row of the grid: a slide's image and body side by side, or spanning the full row width when
// the slide is missing one of them (mirrors gen_slide's image-only/body-only/blank handling)
function gen_grid_row(
    slide:TypstPictureStorySlide, row:number, image_left:boolean, page:PageConfig,
    image_style:ImageStyle, cell_w:string, cell_h:string, content_w:string,
    line_height:number, font_size:string, font_text2:string, font_size2:string,
    font_fallbacks:string[], story_key:string,
):string {
    const dy = `(${cell_h}) * ${row}`
    const is_top = row === 0
    const is_bottom = row === GRID_ROWS - 1

    // No image: the body (if any) spans the full row width, centred and fit-sized to the row's
    // area; blank row otherwise
    if (!slide.image) {
        if (!slide.body) {
            return ''
        }
        const fit = gen_fit_body(
            slide.body, slide.body2, line_height, font_size, font_size2, font_text2,
            font_fallbacks, content_w, cell_h, story_key, FIT_TARGET_RATIO_GRID)
        return gen_grid_text_place('0pt', dy, content_w, cell_h, '0pt', fit)
    }

    const filename = escape_typst_str(slide.image.filename)

    // Image only: fills the whole row, bleeding both the left and right page edge
    if (!slide.body) {
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
    const inset_side = image_left ? page.margin_left : page.margin_right
    const text_inset = image_left ? `(left: ${inset_side})` : `(right: ${inset_side})`
    // The text's available width is its cell minus the inset carved out of the image-facing edge
    const text_w = `(${cell_w}) - (${inset_side})`
    const fit = gen_fit_body(
        slide.body, slide.body2, line_height, font_size, font_size2, font_text2, font_fallbacks,
        text_w, cell_h, story_key, FIT_TARGET_RATIO_GRID)
    const text_place = gen_grid_text_place(text_dx, dy, cell_w, cell_h, text_inset, fit)
    return `${image_place}\n${text_place}`
}


// Place an already-sized/fit content expression into a text cell, clipped to its cell bounds.
// inset (a Typst inset value — a length, or a `(left: ..)`/`(right: ..)` dictionary) pads the
// edge touching the image, if any
function gen_grid_text_place(
    dx:string, dy:string, width:string, height:string, inset:string, content:string,
):string {
    return `#place(top + left, dx: ${dx}, dy: ${dy},
    block(width: ${width}, height: ${height}, clip: true, inset: ${inset}, ${content}))`
}


// Absolutely-placed image for one cell of the grid. Padded (plain/painted/torn) keeps the image
// within its cell; 'borderless' bleeds past the margin on any edge of the cell that's also a true
// page edge — the left and/or right edge of the cell that touches the page side (an image
// spanning the full row width bleeds both), and/or the top/bottom edge of the row when it's the
// first/last on the page
function gen_grid_cell_image(
    filename:string, page:PageConfig, image_style:ImageStyle,
    dx:string, dy:string, width:string, height:string,
    bleed_left:boolean, bleed_right:boolean, is_top:boolean, is_bottom:boolean,
):string {
    if (image_style !== 'borderless') {
        const fit = image_style === 'padded' ? 'cover' : 'contain'
        return `#place(top + left, dx: ${dx}, dy: ${dy},
    block(width: ${width}, height: ${height}, clip: true,
        image("${filename}", width: 100%, height: 100%, fit: "${fit}")))`
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
