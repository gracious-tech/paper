
import {reactive, computed, ref} from 'vue'

import {content} from '@/services/content'

import type {Blueprint, ContentPassage, Creation} from '@/services/types'


// General state
export const state = reactive({
    splash: true,
    tab: 'create' as 'create'|'history'|'help',
    advanced: false,
    editor: null as null|{component:string, props:Record<string, unknown>}
})


// Draft blueprint
// NOTE This will actually get init'd once content.collection is available
export const blue = reactive({} as unknown as Blueprint)


// The width of page as given to WeasyPrint
export const page_width = computed(() => {
    if (blue.page_arrangement === 'booklet'){
        return blue.paper_height / 2
    }
    return blue.paper_width
})


// The height of page as given to WeasyPrint
export const page_height = computed(() => {
    if (blue.page_arrangement === 'booklet'){
        return blue.paper_width
    }
    return blue.paper_height
})


// Whether current blueprint includes a copyright item
export const has_copyright = computed(() => {
    return !!blue.content.find(
        item => item.type === 'custom' && item.html.includes('AUTO-COPYRIGHT'))
})


// Whether current content options require attribution
export const requires_copyright = computed(() => {
    if (blue.notes){
        return true  // TODO Parse restrictions from collection (might have PD ones in future)
    }
    return blue.content.some(item => item.type === 'passage')
        && blue.bibles.some(item =>
            !content.translations[item]?.licenses.find(l => !l.restrictions.forbid_attributionless))
})


// Whether a translation has an ND condition
export const translation_forbids_derivatives = computed(() => {
    return blue.bibles.some(item => !content.translations[item]?.licenses
        .find(l => l.restrictions.forbid_derivatives !== true))
})


// Whether all passages are available in all translations
export const translations_have_passages = computed(() => {
    return blue.bibles.every(bible => {
        return blue.content.filter(i => i.type === 'passage').every(p => {
            const book = (p as ContentPassage).book
            return content.books[bible]?.[book]?.available
        })
    })
})


// History
export const creations = reactive([] as Creation[])
export const selected_id = ref(null as string|null)
export const selected_creation = computed(() => {
    return creations.find(item => item.request_id === selected_id.value)
})
