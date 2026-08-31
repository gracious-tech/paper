
import {computed, type ComputedRef} from 'vue'

import {content} from './content'
import {custom_fonts} from './custom_fonts'


// A v-select item: a font family name, a subheader, or (font_items_with_auto only) the
// "Auto" entry
export type FontItem = string | {type:'subheader', title:string} | {title:string, value:null}


// Shown in a font picker item when no real example text is available yet
export const DEFAULT_FONT_EXAMPLE = "In the beginning God created the heavens and the earth."


// Font picker items, grouped by BundledFont.group with a subheader per group (fonts arrive
// from content.fonts already grouped contiguously, see font_config.json), plus an "Uploaded"
// group for any custom fonts. Shared by any component offering a font picker (OptionsStyle.vue,
// EditorTitle.vue). A curated font whose name collides with an uploaded one is skipped here —
// the custom upload always wins (matches how the generator itself resolves the same collision)
export const font_items = computed(():FontItem[] => {
    const items:FontItem[] = []
    const custom_names = new Set(custom_fonts.map(f => f.family))

    let last_group = ''
    for (const font of content.fonts){
        if (custom_names.has(font.family))
            continue
        if (font.group !== last_group){
            items.push({type: 'subheader', title: font.group})
            last_group = font.group
        }
        items.push(font.family)
    }

    if (custom_fonts.length){
        items.push({type: 'subheader', title: "Uploaded"})
        for (const font of custom_fonts){
            items.push(font.family)
        }
    }

    return items
})


// Same as font_items but with a leading "Auto" option (null value), for pickers that fall
// back to another font when left unset. Takes the caller's own `t()` so the label localises
// in whichever component uses it.
export function font_items_with_auto(t:(key:string) => string):ComputedRef<FontItem[]> {
    return computed(() => [
        {title: t("svc.fonts.auto_match"), value: null},
        ...font_items.value,
    ])
}
