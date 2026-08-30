
// The colors currently in use in the open design — every non-null *_color field on its
// blueprint, deduplicated. Fed into Coloris' swatch row (see services/coloris.ts) so each
// color picker offers the design's other colors as one-click reuse targets. Snapshotted on
// demand rather than kept as a reactive list — callers read it the moment a picker opens, so
// the swatch row can't shift under the user mid-choice
//
// (bookcover's equivalent also derives an "Auto" group from resolve_colors(); this app has no
// colour-resolution engine, so it's just the explicitly chosen values.)

import {blue} from '@/services/state'


// Blueprint fields that hold a user-chosen color
const COLOR_FIELDS = [
    'text_color',
    'titlepage_color_text',
    'titlepage_color_icon',
    'titlepage_color_frame',
    'story_emphasis_color',
    'show_wj_color',
] as const


// Colors set on the open design, in field order, deduplicated case-insensitively
export function design_colors():string[]{
    const seen = new Set<string>()
    const out:string[] = []
    // Collect each field's value, skipping unset ones and repeats
    for (const field of COLOR_FIELDS){
        const value = blue[field]
        if (typeof value !== 'string'){
            continue
        }
        const key = value.toLowerCase()
        if (seen.has(key)){
            continue
        }
        seen.add(key)
        out.push(value)
    }
    return out
}
