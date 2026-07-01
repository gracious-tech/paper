
import {reactive, computed, ref} from 'vue'

import {doc_has_copyright} from 'paper-bible-typst'

import {content} from '@/services/content'

import type {Blueprint, ContentPassage, Creation} from '@/services/types'


// General state
export const state = reactive({
    splash: false,  // TODO true before launch
    tab: 'create' as 'create'|'history'|'help',
    advanced: false,
    editor: null as null|{component:string, props:Record<string, unknown>}
})


// Draft blueprint
// NOTE This will actually get init'd once content.collection is available
export const blue = reactive({} as unknown as Blueprint)


// Whether current blueprint includes a copyright item
export const has_copyright = computed(() => {
    return blue.content.some(
        item => item.type === 'custom' && doc_has_copyright(item.doc))
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


// Whether any selected translation supports words-of-Jesus markup (red letters)
export const supports_wj = computed(() => {
    return blue.bibles.some(bible => content.wj_markup[bible])
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
