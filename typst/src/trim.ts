
// Resolve a Blueprint's trim (page) size from its printing service + named size, or its
// manually entered custom dimensions. Shared by the interior margin clamp (bible_content.ts)
// and the cover's narrow-book back-margin default (app/src/services/cover.ts).

import {get_common_sizes, get_service} from 'printing-services'

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
