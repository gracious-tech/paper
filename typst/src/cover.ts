
// Cover render helpers shared by the app (bookcover-web worker) and the server
// (bookcover-node). The cover's size fields always come from the blueprint's own printing
// fields at render time, so book-size changes can never desync the cover's trim/spine from
// the book they wrap. The page count is not a blueprint field at all — it's a property of the
// compiled interior, so callers pass the actual count (version creation, where the cover is
// rendered after the interior) or an estimate (live preview).

import {resolve_reading_trim} from './trim.js'

import type {Blueprint, CoverConfig} from './types.js'


// The wizard's generic fallback stock photos (offered when a book has no thematic default).
// bookcover dropped these images' black_/white_ prefixes in its 0.9.0 release — filenames here
// must track the assets bucket's actual current names, not just be internally consistent
export const STOCK_BG_PHOTOS = [
    'hills_trees.jpg',
    'hills.jpg',
    'snow_trees.jpg',
    'stars.jpg',
]


// Every builtin background filename this app is allowed to reference (STOCK_BG_PHOTOS plus
// every value used by the app's own book-themed BOOK_BG_PHOTO map, duplicated here since a
// shared core package can't depend on app-only code). Used both to validate a client-supplied
// cover's bg_image.id (blueprint_schema.ts, server compile.ts) and, indirectly, as the set a
// fast builtin-color lookup can ever match — keep in sync with BOOK_BG_PHOTO's values (a
// DEV-only console check in app/src/services/cover.ts catches drift)
export const KNOWN_BUILTIN_BACKGROUNDS = new Set<string>([
    ...STOCK_BG_PHOTOS,
    'earth_whole.jpg', 'israel.jpg', 'stars.jpg', 'wilderness.jpg', 'lost_sheep.jpg',
    'sword.jpg', 'wasteland.jpg', 'crops.jpg', 'crown.jpg', 'growing.jpg', 'sunset.jpg',
    'lake.jpg', 'hills_trees.jpg', 'mist.jpg', 'flowers.jpg', 'israel_lake.jpg', 'lion.jpg',
    'desert.jpg', 'sea.jpg', 'cross_sun.jpg', 'church.jpg', 'opening.jpg', 'tomb.jpg',
    'awe.jpg', 'hills.jpg', 'grass.jpg', 'sheep.jpg', 'burning.jpg', 'green.jpg', 'cross.jpg',
    'earth.jpg',
])


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
    const size_id = blueprint.booklet ? '' : blueprint.size_id
    const unit = blueprint.booklet
        ? (trim.unit === 'mm' ? 'mm' : 'inch') : blueprint.custom_unit
    const trim_width = blueprint.booklet ? trim.width : blueprint.custom_trim_width
    const trim_height = blueprint.booklet ? trim.height : blueprint.custom_trim_height

    return {
        ...cover.form,
        service_id: manual ? 'custom' : blueprint.service_id,
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
