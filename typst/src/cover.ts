
// Cover render helpers shared by the app (bookcover-web worker) and the server
// (bookcover-node). The cover's size fields always come from the blueprint's own printing
// fields at render time, so book-size changes can never desync the cover's trim/spine from
// the book they wrap. The page count is not a blueprint field at all — it's a property of the
// compiled interior, so callers pass the actual count (version creation, where the cover is
// rendered after the interior) or an estimate (live preview).

import {resolve_reading_trim} from './trim.js'

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
// Deliberately a shape check rather than an allowlist: the widget offers the user every
// background bookcover publishes, and an allowlist here would have to be kept in sync with that
// catalogue across two repos — the exact duplicated-table problem the 0.11 contract removed
export function is_builtin_background(id:string):boolean{
    return id.length > 0 && id.length <= 128
        && !id.includes('/') && !id.includes('\\') && !id.includes('..')
        && BG_EXTENSIONS.some(ext => id.toLowerCase().endsWith(ext))
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
    // booklet sheet). The blueprint's manual bleed/spine aren't even offered in home mode
    const bleed = home ? 0 : blueprint.custom_bleed
    const spine = home ? 0 : blueprint.custom_spine

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
