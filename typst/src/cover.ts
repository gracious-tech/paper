
// Cover render helpers shared by the app (bookcover-web worker) and the server
// (bookcover-node). The cover's size fields always come from the blueprint's own printing
// fields at render time, so book-size/page-count changes can never desync the cover's
// trim/spine from the book they wrap.

import type {Blueprint, CoverConfig} from './types.js'


// Overlay the blueprint's live printing fields onto a stored cover form, returning a new
// form ready for bookcover's build_schema. paper.bible's 'home' (and 'custom') service has
// no bookcover equivalent, so it maps to the widget's 'custom' service with the blueprint's
// manual bleed/spine — for real printing services the spine is derived from page_count
export function cover_form_for_render(cover:CoverConfig, blueprint:Blueprint)
        :Record<string, unknown>{
    const manual = blueprint.service_id === 'home' || blueprint.service_id === 'custom'
    return {
        ...cover.form,
        service_id: manual ? 'custom' : blueprint.service_id,
        size_id: blueprint.size_id,
        page_count: blueprint.page_count,
        binding_type: blueprint.binding_type,
        ink_type: blueprint.ink_type,
        paper_type: blueprint.paper_type,
        custom_unit: blueprint.custom_unit,
        custom_trim_width: blueprint.custom_trim_width,
        custom_trim_height: blueprint.custom_trim_height,
        custom_bleed: blueprint.custom_bleed,
        custom_spine: blueprint.custom_spine,
    }
}


// Stable cache key for a rendered cover — identical keys guarantee identical output bytes
// (same resolved form, same bg image, same font set), so book-only edits reuse the render
export function cover_render_key(cover:CoverConfig, blueprint:Blueprint):string{
    return JSON.stringify(cover_form_for_render(cover, blueprint))
        + '|' + (cover.bg_image_hash ?? '')
        + '|' + cover.font_families.join(',')
}
