
<template lang='pug'>

v-card(class='ma-4 d-flex flex-column flex-grow-1')

    v-card-title(class='d-flex align-center justify-space-between')
        v-text-field.search(v-if='show_languages' v-model='languages_search' variant='plain'
            type='search' placeholder="Search..." density='compact' hide-details single-line
            class='flex-grow-1')
        template(v-else)
            v-btn(icon color='primary' variant='text' @click='show_languages = true')
                app-icon(name='arrow_back')
            | {{ displayed_language_name }}
        v-btn(@click='cancel' variant='text') Cancel

    v-divider

    v-card-text(class='overflow-y-auto')
        v-list(v-if='show_languages' ref='lang_list_comp')
            v-list-item(v-for='lang of languages_filtered' :key='lang.code' density='compact'
                    @click='change_lang(lang.code)')
                v-list-item-title
                    | {{ lang.local }}
                    |
                    template(v-if='lang.local !== lang.english') ({{ lang.english }})
            v-btn(v-if='!languages_search && !languages_show_all' variant='text' color='primary'
                    @click='languages_show_all = true')
                app-icon(name='expand_more')
                | &nbsp;
                | More
        v-list(v-else)
            v-list-item(base-color='warning')
                v-list-item-title NIV / ESV / NLT / ...
                DialogPeddlers
            v-list-item(v-for='trans of translations' :key='trans.id' color='primary'
                    :active='trans.id === selected_trans' density='compact'
                    @click='change_trans(trans.id)')
                v-list-item-title
                    | {{ trans.name_abbrev }} &mdash; {{ trans.name_local || trans.name_english }}

</template>


<script lang='ts' setup>


import {computed, ref, watch} from 'vue'

import {blue, state} from '@/services/state'

import {content} from '@/services/content'

import DialogPeddlers from '@/comp/dialogs/DialogPeddlers.vue'

import type {VList} from 'vuetify/lib/components/VList/index.mjs'


const props = defineProps<{bibles_index:number}>()
const initial_trans = blue.bibles[props.bibles_index] || blue.bibles[0]!
if (!blue.bibles[props.bibles_index]){
    blue.bibles[props.bibles_index] = initial_trans
}


// Contants
const languages = content.collection.get_languages()
// NOTE First 50 languages covers 69% of world (even more those technically literate)
const languages_by_pop = content.collection.get_languages({sort_by: 'population'}).slice(0, 50)


// State
const selected_trans = ref(initial_trans)
const show_languages = ref(false)
const displayed_language = ref(initial_trans.split('_')[0]!)
const languages_search = ref('')
const languages_show_all = ref(false)
const lang_list_comp = ref<InstanceType<typeof VList>>()


// Computes
const displayed_language_name = computed(() => {
    return content.languages[displayed_language.value]!.local
})
const translations = computed(() => {
    return content.collection.get_translations({language: displayed_language.value})
})
const languages_filtered = computed(() => {
    if (languages_search.value){
        return content.collection.get_languages({search: languages_search.value})
    }
    return languages_show_all.value ? languages : languages_by_pop
})


// Watches
watch(languages_show_all, () => {
    // Scroll back to top of lang list when showing all, as new items will be added to top
    lang_list_comp.value?.$el.scroll({top: 0})
})


// Methods

const change_lang = (code:string) => {
    displayed_language.value = code
    if (translations.value.length === 1){
        change_trans(translations.value[0]!.id)
    }
    show_languages.value = false
}

const change_trans = (id:string) => {
    blue.bibles[props.bibles_index] = id
    state.editor = null
}

const cancel = () => {
    state.editor = null
}


</script>


<style lang='sass' scoped>

.v-card-title
    font-size: 1.2rem
    // So same height when changing between states (height of icon button)
    height: 48px
    box-sizing: content-box

.v-card-text
    padding-bottom: 30vh

.search :deep() .v-field__input
    padding: 0 !important


</style>
