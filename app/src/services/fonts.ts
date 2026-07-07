
import {computed, type ComputedRef} from 'vue'

import {content} from './content'


// A v-select item: a font family name, a subheader, or (font_items_with_auto only) the
// "Auto" entry
export type FontItem = string | {type:'subheader', title:string} | {title:string, value:null}


// Font picker items, grouped by BundledFont.group with a subheader per group (fonts arrive
// from content.fonts already grouped contiguously, see font_config.json). Shared by any
// component offering a font picker (OptionsStyle.vue, EditorTitle.vue)
export const font_items = computed(():FontItem[] => {
    const items:FontItem[] = []
    let last_group = ''
    for (const font of content.fonts){
        if (font.group !== last_group){
            items.push({type: 'subheader', title: font.group})
            last_group = font.group
        }
        items.push(font.family)
    }
    return items
})


// Same as font_items but with a leading "Auto" option (null value), for pickers that fall
// back to another font when left unset. Takes the caller's own `t()` so the label localises
// in whichever component uses it.
export function font_items_with_auto(t:(key:string) => string):ComputedRef<FontItem[]> {
    return computed(() => [
        {title: t("Auto (matches text font)"), value: null},
        ...font_items.value,
    ])
}
