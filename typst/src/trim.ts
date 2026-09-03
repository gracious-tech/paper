
// Resolve a Blueprint's trim (page) size from its printing service + named size, or its
// manually entered custom dimensions. Shared by the interior margin clamp (bible_content.ts)
// and the cover's narrow-book back-margin default (app/src/services/cover.ts).

import {get_common_sizes, get_service} from 'printing-services'

import type {BindingTypeId, SizeId, UnitType} from 'printing-services'
import type {Blueprint} from './types.js'


// Map printing-services' unit string ('mm'|'inch') to the typst unit ('mm'|'in')
export function norm_unit(unit:string):'mm'|'in' {
    return unit === 'mm' ? 'mm' : 'in'
}


// Convert a length between mm/in (trim size and margins can be recorded in different units)
export function convert_unit(value:number, from:'mm'|'in', to:'mm'|'in'):number {
    if (from === to) {
        return value
    }
    return from === 'mm' ? value / 25.4 : value * 25.4
}


// Work out the trim dimensions from the selected printing service + named size, or the
// manually entered custom dimensions
export function resolve_trim(blue:Blueprint):{width:number, height:number, unit:'mm'|'in'} {

    // Custom dimensions (no named size selected)
    const custom = {
        width: blue.custom_trim_width,
        height: blue.custom_trim_height,
        unit: norm_unit(blue.custom_unit),
    }
    if (blue.size_id === '') {
        return custom
    }

    // Named size: from the common list for the service-less modes (home/custom), else service
    const use_common = blue.service_id === 'custom' || blue.service_id === 'home'
    const sizes = use_common
        ? get_common_sizes({numbers: 'number'})
        : get_service(blue.service_id as Parameters<typeof get_service>[0])
            .get_sizes({numbers: 'number', all: true})
    const size = sizes.find(s => s.id === blue.size_id)
    if (!size) {
        // Size id not offered by this service — fall back to the custom dimensions
        return custom
    }
    return {width: size.width, height: size.height, unit: norm_unit(size.unit)}
}


// Map the blueprint's margin unit ('mm'|'in') to printing-services' unit string ('mm'|'inch')
function ps_unit(unit:'mm'|'in'):UnitType {
    return unit === 'mm' ? 'mm' : 'inch'
}


// The binding gutter (extra inner-margin space that's swallowed by the spine) for the
// blueprint's chosen printing service, size and binding, as calculated by printing-services —
// returned in the blueprint's own margin unit. Returns 0 when there's no service to ask
// (home/booklet/custom modes) or the service can't produce a figure for this combination.
// `page_count` matters because a thicker book needs a deeper gutter, so callers pass their
// best current estimate (see margin_gutter_auto).
export function resolve_binding_gutter(blue:Blueprint, page_count:number):number {

    // Only a real printing service (not the fold-at-home / bring-your-own modes) has a gutter
    if (blue.booklet || blue.service_id === 'home' || blue.service_id === 'custom'
            || blue.service_id === '') {
        return 0
    }

    // Ask the service for its interior dimensions at this size, binding and page count
    try {
        const service = get_service(blue.service_id as Parameters<typeof get_service>[0])
        if (!service) {
            return 0
        }
        const size = blue.size_id !== ''
            ? blue.size_id as SizeId
            : {
                unit: ps_unit(norm_unit(blue.custom_unit)),
                width: blue.custom_trim_width,
                height: blue.custom_trim_height,
            }
        const dims = service.get_dimensions({
            size,
            pages: Math.max(1, Math.round(page_count)),
            binding_type: blue.binding_type as BindingTypeId,
            unit: ps_unit(blue.margin_unit),
            numbers: 'number',
        })
        return Math.max(0, dims.interior_gutter)
    } catch {
        // Size/binding combination this service doesn't support — no gutter to add
        return 0
    }
}
