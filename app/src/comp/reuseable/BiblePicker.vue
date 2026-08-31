
<template lang='pug'>

v-card-title(class='d-flex align-center')
    v-text-field.search(v-if='show_languages' v-model='languages_search' variant='plain'
        type='search' :placeholder='$t("common.search") + "..."' density='compact' hide-details single-line
        class='flex-grow-1')
    template(v-else)
        v-btn(icon color='primary' variant='text' @click='show_languages = true')
            app-icon(name='arrow_back')
        | {{ displayed_language_name }}
    v-spacer
    slot(name='actions')

v-divider

v-card-text(class='overflow-y-auto')
    v-list(v-if='show_languages' ref='lang_list_comp')
        v-list-item(v-for='lang of languages_filtered' :key='lang.code' density='compact'
                @click='change_lang(lang.code)')
            v-list-item-title {{ lang.name_bilingual }}
        v-btn(v-if='!languages_search && !languages_show_all' variant='text' color='primary'
                @click='languages_show_all = true')
            app-icon(name='expand_more')
            | &nbsp;
            | {{$t("common.more")}}
    v-list(v-else)
        //- NOTE @click='' needed to make Vuetify show cursor etc as if clickable
        v-list-item(v-if='displayed_language === "eng"' base-color='warning' @click='')
            v-list-item-title NIV / ESV / NLT / ...
            DialogPeddlers
        template(v-for='trans of translations')
            v-list-subheader(v-if='typeof trans === "string"' :key='trans' class='mt-4') {{ trans }}
            v-list-item(v-else :key='trans.id' color='primary'
                    :active='trans.id === modelValue' density='compact'
                    @click='change_trans(trans.id)')
                v-list-item-title
                    | {{ trans.name_abbrev }} &mdash; {{ trans.name }}
                v-list-item-subtitle(v-if='trans.name_english !== trans.name') {{ trans.name_english }}

</template>


<script lang='ts' setup>


import {computed, ref, watch} from 'vue'

import {content} from '@/services/content'
import DialogPeddlers from '@/comp/dialogs/DialogPeddlers.vue'

import type {VList} from 'vuetify/components'
import type {GetResourcesItem} from '@gracious.tech/fetch-client'


// Generic language + translation picker (used by the editor's EditorBible wrapper and the
// new-design wizard) — selection is emitted only, the host decides what to do with it
const props = defineProps<{modelValue:string|null}>()
const emit = defineEmits<{(e:'update:modelValue', id:string):void}>()


// Constants
const languages = content.collection.get_languages()
// NOTE First 50 languages covers 69% of world (even more those technically literate)
const languages_by_pop = content.collection.get_languages({sort_by: 'population'}).slice(0, 50)


// State (initial language from the current selection, else the user's preferred translation)
const initial_trans = props.modelValue ?? content.collection.get_preferred_resource().id
const show_languages = ref(false)
const displayed_language = ref(initial_trans.split('_')[0]!)
const languages_search = ref('')
const languages_show_all = ref(false)
const lang_list_comp = ref<InstanceType<typeof VList>>()


// Computes
const displayed_language_name = computed(() => {
    return content.languages[displayed_language.value]!.name_local
})
const translations = computed(() => {

    // Get translations by category
    const decent = content.collection.get_resources({language: displayed_language.value,
        exclude_obsolete: true})
    const niche = content.collection.get_resources({language: displayed_language.value})
        .filter(i => !decent.find(di => di.id === i.id))

    // Add in separate groups
    const items:(GetResourcesItem|string)[] = decent
    if (niche.length){
        items.push("Historical & Niche Translations")
        items.push(...niche)
    }
    return items
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
    lang_list_comp.value?.$el?.scroll({top: 0})
})


// Methods

const change_lang = (code:string) => {
    displayed_language.value = code
    // Auto-select when the language has a single translation (guard against the entry being a
    // group-header string rather than a translation)
    const only = translations.value.length === 1 ? translations.value[0] : null
    if (only && typeof only !== 'string'){
        change_trans(only.id)
    }
    show_languages.value = false
}

const change_trans = (id:string) => {
    emit('update:modelValue', id)
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
