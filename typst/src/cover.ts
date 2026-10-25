
// Cover render helpers shared by the app (bookcover-web worker) and the server
// (bookcover-node). The cover's size fields always come from the blueprint's own printing
// fields at render time, so book-size changes can never desync the cover's trim/spine from
// the book they wrap. The page count is not a blueprint field at all — it's a property of the
// compiled interior, so callers pass the actual count (version creation, where the cover is
// rendered after the interior) or an estimate (live preview).

import {get_builtin_bg, resolve_dimensions} from 'bookcover-core'

import {resolve_reading_trim, usable_length} from './trim.js'

import type {DimensionInputs} from 'bookcover-core'
import type {Blueprint, CoverConfig} from './types.js'


// Image extensions a builtin background filename may have (bookcover publishes .jpg only today,
// the rest are accepted so a future format doesn't need a coordinated release here)
const BG_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']


// Whether a client-supplied bg_image.id is a usable builtin background reference. bookcover's
// contract is that the published filename IS the id: both the app (a URL against the assets
// bucket) and the server (a path against the assets mount) join it onto their own base, so this
// only has to bound it to a single plain filename — no separators, no traversal, real image
// extension. Existence is left to the fetch/read that follows, which fails the cover render
// (never the book compile) if bookcover has retired that background.
// A shape check only, so it's what stored blueprints are validated with: a background bookcover
// later retires should fail its own fetch, not be silently dropped from every design naming it.
// Anything about to become a path or URL fresh from an untrusted source uses
// is_known_builtin_background() below instead
export function is_builtin_background(id:string):boolean{
    return id.length > 0 && id.length <= 128
        && !id.includes('/') && !id.includes('\\') && !id.includes('..')
        && BG_EXTENSIONS.some(ext => id.toLowerCase().endsWith(ext))
}


// Whether an id names a builtin background bookcover actually ships — the shape check above plus
// membership in bookcover-core's baked table (its keys are exactly the published IDs), so the
// allowlist comes from the installed package rather than a second copy kept here. The bucket's
// backgrounds/ also holds previews_*/, thumbnails/ and originals/ subdirectories, which the
// no-slash rule keeps out regardless of what the table contains
export function is_known_builtin_background(id:string):boolean{
    return is_builtin_background(id) && get_builtin_bg(id) !== null
}


// Overlay the blueprint's live printing fields (plus the caller-derived page count) onto a
// stored cover form, returning a new form ready for bookcover's build_schema. paper.bible's
// 'home' (and 'custom') service has no bookcover equivalent, so it maps to the widget's
// 'custom' service with the blueprint's manual bleed/spine — for real printing services the
// spine is derived from page_count
export function cover_form_for_render(cover:CoverConfig, blueprint:Blueprint,
        page_count:number):Record<string, unknown>{
    const home = blueprint.service_id === 'home'
    const manual = home || blueprint.service_id === 'custom'

    // Home printing is a plain A4/US-Letter sheet: nothing is trimmed and nothing is bound
    // along a spine, so the wraparound is exactly two trim faces wide (matching an interior
    // booklet sheet). The blueprint's manual bleed/spine aren't even offered in home mode.
    // A cleared bleed/spine field hands back '' (see usable_length), which bookcover rejects
    const bleed = home ? 0 : usable_length(blueprint.custom_bleed)
    const spine = home ? 0 : usable_length(blueprint.custom_spine)

    // A fold-at-home booklet's chosen size is the sheet that gets folded, so the finished book
    // is half of it — the cover must wrap a reading page, not the sheet. No named size can
    // express the halved dimensions, so pass them as custom size fields instead
    const trim = resolve_reading_trim(blueprint)
    // Two independent reasons a cover has no named size: a booklet (halved dimensions no named
    // size can express, see above) and a blueprint whose own size_id is blank because the user
    // entered custom dimensions. bookcover 0.11 carries that in size_mode rather than the old
    // blank-size_id sentinel; size_id is still sent but is only meaningful when 'preset'
    const size_mode = (blueprint.booklet || !blueprint.size_id) ? 'custom' : 'preset'
    const size_id = size_mode === 'preset' ? blueprint.size_id : ''
    const unit = blueprint.booklet ? trim.unit : blueprint.custom_unit
    const trim_width = blueprint.booklet ? trim.width : blueprint.custom_trim_width
    const trim_height = blueprint.booklet ? trim.height : blueprint.custom_trim_height

    return {
        ...cover.form,
        service_id: manual ? 'custom' : blueprint.service_id,
        size_mode,
        size_id,
        page_count,
        binding_type: blueprint.binding_type,
        ink_type: blueprint.ink_type,
        paper_type: blueprint.paper_type,
        custom_unit: unit,
        custom_trim_width: trim_width,
        custom_trim_height: trim_height,
        custom_bleed: bleed,
        custom_spine: spine,
    }
}


// Stable cache key for a rendered cover — identical keys guarantee identical output bytes
// (same resolved form, same bg image, same font set), so book-only edits reuse the render
export function cover_render_key(cover:CoverConfig, blueprint:Blueprint,
        page_count:number):string{
    const bg_key = cover.bg_image
        ? cover.bg_image.kind === 'builtin' ? `builtin:${cover.bg_image.id}`
            : `custom:${cover.bg_image.hash}`
        : ''
    return JSON.stringify(cover_form_for_render(cover, blueprint, page_count))
        + '|' + bg_key
        + '|' + cover.font_families.join(',')
}


// Where a rendered wraparound cover's trim box and fold guide lines fall, in points, as resolved
// from bookcover's mm-based layout
export interface CoverPageGeometry {
    // Trim box to crop to, measured from the page's top-left, or null when the cover has no bleed
    crop:{left:number, top:number, width:number, height:number}|null
    // X positions of the 50%-gray fold guide lines
    fold_x:number[]
}


export function cover_page_geometry(blueprint:Blueprint, page_count:number):CoverPageGeometry {
    // Where the wraparound cover's trim box and fold guide lines fall on the rendered page, in
    // points measured from its top-left. Uses the same dimensions bookcover uses to split the
    // wraparound into panels — its layout is mm-based and the page is pt, so this converts mm ->
    // pt exactly as bookcover's splitter does
    const dims = resolve_dimensions(cover_form_for_render(
        blueprint.cover!, blueprint, page_count) as unknown as DimensionInputs)
    const mm_to_pt = (mm:number) => mm / 25.4 * 72
    const back = dims.cover_region_back
    const front = dims.cover_region_front

    // The trim box (bleed dropped) — only when there's bleed to hide
    const left = mm_to_pt(back.x.toNumber())
    const right = mm_to_pt(front.x.toNumber() + front.w.toNumber())
    const crop = dims.cover_has_bleed
        ? {left, top: mm_to_pt(back.y.toNumber()), width: right - left,
            height: mm_to_pt(back.h.toNumber())}
        : null

    // The spine's left and right edges when the book has a spine, otherwise a single line on
    // the fold between the back and front panels
    const fold_mm = dims.cover_has_spine
        ? [dims.cover_region_spine.x.toNumber(),
            dims.cover_region_spine.x.toNumber() + dims.cover_region_spine.w.toNumber()]
        : [front.x.toNumber()]
    return {crop, fold_x: fold_mm.map(mm_to_pt)}
}


export function crop_cover_svg(svg:string, geometry:CoverPageGeometry):string {
    // A rendered wraparound cover (an SVG whose viewBox is in points, as Typst writes them) as a
    // preview shows it: cropped to its trim box, so the bleed is hidden, with thin 50%-gray guide
    // lines on the fold(s). Both are preview aids; the printed cover is rendered separately
    const open_start = svg.indexOf('<svg')
    const open_end = svg.indexOf('>', open_start) + 1
    const view_box = /viewBox="([^"]+)"/.exec(svg.slice(open_start, open_end))?.[1] ?? '0 0 0 0'
    const [x, y, width, height] = view_box.trim().split(/[\s,]+/).map(Number) as
        [number, number, number, number]
    const box = geometry.crop ?? {left: x, top: y, width, height}

    // The root's box and size replaced, everything else about it kept
    const open_tag = svg.slice(open_start, open_end)
        .replace(/\s(?:viewBox|width|height)="[^"]*"/g, '')
        .replace(/^<svg/, `<svg viewBox="${box.left} ${box.top} ${box.width} ${box.height}"`
            + ` width="${box.width}pt" height="${box.height}pt"`)
    const lines = geometry.fold_x.map(fold => `<line x1="${fold}" y1="${y}" x2="${fold}"`
        + ` y2="${y + height}" stroke="rgb(128,128,128)" stroke-width="0.5"/>`).join('')
    const close = svg.lastIndexOf('</svg>')
    return svg.slice(0, open_start) + open_tag + svg.slice(open_end, close) + lines
        + svg.slice(close)
}
