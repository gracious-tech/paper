
// Resolve a Blueprint's trim (page) size from its printing service + named size, or its
// manually entered custom dimensions. Shared by the interior margin clamp (bible_content.ts)
// and the cover's narrow-book back-margin default (app/src/services/cover.ts).

import {get_common_sizes, get_service} from 'printing-services'

import type {BindingTypeId, SizeId} from 'printing-services'
import type {Blueprint, MeasureUnit} from './types.js'


// Map a measurement unit to the suffix Typst uses for it — the one place the two spellings
// differ, so it lives here rather than leaking a second unit vocabulary into the blueprint
export function typst_unit(unit:MeasureUnit):'mm'|'in' {
    return unit === 'mm' ? 'mm' : 'in'
}


// Convert a length between mm/inches (trim size and margins can be recorded in different units)
export function convert_unit(value:number, from:MeasureUnit, to:MeasureUnit):number {
    if (from === to) {
        return value
    }
    return from === 'mm' ? value / 25.4 : value * 25.4
}


// A user-entered spacing length (margin, column gap) as a number Typst can lay out. The editor's
// number fields have no bounds: a cleared field hands back '' and arrow-stepping runs freely below
// zero (0.95 - 1 = -0.050000000000000044), and neither renders, so both mean "no space"
export function usable_length(value:number):number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}


// The size a cleared custom trim dimension stands in for (the default blueprint's)
const FALLBACK_TRIM_MM = {width: 152, height: 229}

// The smallest side a page is ever laid out at, whatever was entered: a field mid-edit passes
// through every value on the way to the one meant (typing 355 is 3 first), and a tiny page sends
// the compiler into thousands of pages or traps it outright. Below any size worth printing (the
// smallest a printing service offers is 108mm wide), but it still allows an A7 pocket booklet
const MIN_PAGE_MM = 70


function at_least_min_page(value:number, unit:MeasureUnit):number {
    // A page side raised to MIN_PAGE_MM, in the side's own unit
    return Math.max(value, convert_unit(MIN_PAGE_MM, 'mm', unit))
}


// The custom trim dimensions as a size that can be laid out. Like usable_length's fields, these
// have no bounds: a cleared one hands back '' (which Typst reads as a bare unit, and bookcover
// rejects), so that falls back to the default size, and a tiny one is raised to MIN_PAGE_MM
export function usable_custom_trim(blue:Blueprint)
        :{width:number, height:number, unit:MeasureUnit} {
    const unit = blue.custom_unit
    const side = (value:number, fallback_mm:number):number => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return convert_unit(fallback_mm, 'mm', unit)
        }
        return at_least_min_page(value, unit)
    }
    return {
        width: side(blue.custom_trim_width, FALLBACK_TRIM_MM.width),
        height: side(blue.custom_trim_height, FALLBACK_TRIM_MM.height),
        unit,
    }
}


// Work out the trim dimensions from the selected printing service + named size, or the
// manually entered custom dimensions
export function resolve_trim(blue:Blueprint):{width:number, height:number, unit:MeasureUnit} {

    // Custom dimensions (no named size selected)
    const custom = usable_custom_trim(blue)
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
    return {width: size.width, height: size.height, unit: size.unit}
}


// The size of an actual reading page — the trim size, halved for fold-at-home booklets. A
// booklet's chosen size is the sheet that gets folded in half, so each reading page is half of
// it: fold across the sheet's longer axis and rotate the result upright (an A4 sheet yields A5
// pages, US Letter yields half-Letter). Both the interior page config and the cover need this
// same finished-book size — the sheet only reappears when apply_booklet() (pdf_postprocess.ts)
// places two reading pages side by side
export function resolve_reading_trim(blue:Blueprint)
        :{width:number, height:number, unit:MeasureUnit} {
    // A booklet's half-sheet is held to MIN_PAGE_MM too, since halving can undercut it
    const trim = resolve_trim(blue)
    if (!blue.booklet) {
        return trim
    }
    const longer = Math.max(trim.width, trim.height)
    const shorter = Math.min(trim.width, trim.height)
    return {width: at_least_min_page(longer / 2, trim.unit),
        height: at_least_min_page(shorter, trim.unit), unit: trim.unit}
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
                unit: blue.custom_unit,
                width: blue.custom_trim_width,
                height: blue.custom_trim_height,
            }
        const dims = service.get_dimensions({
            size,
            pages: Math.max(1, Math.round(page_count)),
            binding_type: blue.binding_type as BindingTypeId,
            unit: blue.margin_unit,
            numbers: 'number',
        })
        return Math.max(0, dims.interior_gutter)
    } catch {
        // Size/binding combination this service doesn't support — no gutter to add
        return 0
    }
}
