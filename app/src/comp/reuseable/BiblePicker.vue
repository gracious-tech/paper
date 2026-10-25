
<template lang='pug'>

v-card-title(class='d-flex align-center')
    v-text-field.search(v-if='show_languages' v-model='languages_search' variant='plain'
        type='search' :placeholder='$t("common.search") + "..."' density='compact' hide-details single-line
        class='flex-grow-1')
    template(v-else)
        v-btn(color='primary' variant='text' @click='show_languages = true')
            app-icon(name='arrow_back')
            | &nbsp;
            | {{ $t("common.languages") }}
        v-spacer
        span.lang_name {{ displayed_language_name }}
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
            //- Not words to translate (i18n-ignore)
            v-list-item-title NIV / ESV / NLT / ...
            DialogPeddlers
        template(v-for='trans of translations')
            v-list-subheader(v-if='typeof trans === "string"' :key='trans' class='mt-4') {{ trans }}
            v-list-item(v-else :key='trans.id' color='primary'
                    :active='trans.id === modelValue' density='compact'
                    @click='change_trans(trans.id)')
                //- Name and facts, with the info button beside them (not the description)
                div.head
                    div.head_text
                        v-list-item-title
                            | {{ trans.name_abbrev }} &mdash; {{ trans.name }}
                        v-list-item-subtitle(v-if='trans.name_english !== trans.name')
                            | {{ trans.name_english }}
                        //- Each fact is a chunk of its own, so a line breaks between facts if it can
                        v-list-item-subtitle.facts(v-if='trans.details?.facts.length')
                            span.fact(v-for='fact of trans.details.facts' :key='fact') {{ fact }}
                    //- Translation's own site, without selecting it
                    v-btn(v-if='trans.details && trans.attribution_url' icon variant='text'
                            size='small' :href='trans.attribution_url' target='_blank'
                            rel='noopener' :aria-label='$t("common.about_translation")' @click.stop)
                        app-icon(name='info')
                v-list-item-subtitle.description(v-if='trans.details?.description')
                    | {{ trans.details.description }}

    div(class='cant_find text-center')
        v-btn(variant='text' color='primary')
            | {{ $t("dialog.missing_translation.title") }}
            DialogMissingTranslation

</template>


<script lang='ts' setup>


import {computed, ref, watch} from 'vue'

import {content, ensure_bible_descriptions} from '@/services/content'
import {bible_details} from '@/services/bible_details'
import {default_bible} from '@/services/blueprints'
import {useI18n} from '@/services/i18n'
import DialogPeddlers from '@/comp/dialogs/DialogPeddlers.vue'
import DialogMissingTranslation from '@/comp/dialogs/DialogMissingTranslation.vue'

import type {VList} from 'vuetify/components'
import type {GetResourcesItem} from '@gracious.tech/fetch-client'
import type {BibleDetails} from '@/services/bible_details'


// Generic language + translation picker (used by the editor's EditorBible wrapper and the
// new-design wizard) — selection is emitted only, the host decides what to do with it
const props = defineProps<{modelValue:string|null}>()
const emit = defineEmits<{(e:'update:modelValue', id:string):void}>()
const {t} = useI18n()


// Constants
const languages = content.collection.get_languages()
// NOTE First 50 languages covers 69% of world (even more those technically literate)
const languages_by_pop = content.collection.get_languages({sort_by: 'population'}).slice(0, 50)


// State (initial language from the current selection, else the user's preferred translation)
const initial_trans = props.modelValue ?? default_bible()
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

    // Details go under English's main translations only for now (no other language has
    // descriptions yet, and the niche group is there for completeness rather than to choose from)
    const descriptions = content.descriptions[displayed_language.value]
    const with_details = displayed_language.value === 'eng'

    // Add in separate groups
    const items:((GetResourcesItem & {details?:BibleDetails})|string)[] = decent.map(trans => {
        return with_details
            ? {...trans, details: bible_details(trans, descriptions?.[trans.id], t)}
            : trans
    })
    if (niche.length){
        items.push(t("common.niche_translations"))
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
watch(displayed_language, language => {
    // Fetch the descriptions shown under English's translations (see translations)
    if (language === 'eng'){
        void ensure_bible_descriptions(language)
    }
}, {immediate: true})
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


<style lang='sss' scoped>

.v-card-title
    font-size: 1.2rem
    // So same height when changing between states (height of icon button)
    height: 48px
    box-sizing: content-box

// Centered language name between the "Languages" button and the actions slot
.lang_name
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    font-size: 16px

.v-card-text
    padding-bottom: 30vh

// A translation's name and facts, beside its info button
.head
    display: flex
    align-items: center

.head_text
    flex-grow: 1
    min-width: 0

// Facts and descriptions (up to 100 characters) wrap on a phone, where Vuetify's one line
// would cut them off. Facts are bold, to set them apart from the description below
.v-list-item-subtitle.facts
    -webkit-line-clamp: 2
    margin-top: 2px
    font-weight: 600

// Facts separated by a middle dot, which stays at the end of a line when the next fact wraps
.fact
    display: inline-block
    &:not(:last-child)::after
        content: '·'
        padding: 0 0.4em
        font-weight: 400

.v-list-item-subtitle.description
    -webkit-line-clamp: 3
    margin-top: 2px

.cant_find
    margin-top: 24px

.search :deep() .v-field__input
    padding: 0 !important


</style>
