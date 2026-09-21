<template lang='pug'>

div(class='text-title-small mt-4') {{$t("options.features.numbers")}}
v-checkbox(v-model='blue.show_chapters' :label='$t("common.chapter_numbers")')
v-checkbox(v-model='blue.show_verses' :label='$t("options.features.verse_numbers")')
v-checkbox(v-model='blue.running_pages' :label='$t("options.features.page_numbers")')
div(class='text-title-small mt-4') {{$t("options.features.headings")}}
v-checkbox(v-model='blue.show_headings' :label='$t("options.features.section_headings")')
v-checkbox(v-model='blue.running_headings' :label='$t("options.features.book_chapter_name")')
AppOptionToggle(v-model='passage_title' :label='$t("options.layout.passage_titles")'
    :items='passage_title_items' class='my-2')
div(class='text-title-small mt-4') {{$t("options.features.notes")}}
AppOptionToggle(v-model='footnotes_mode' :items='footnotes_mode_items' class='my-2')
p(v-if='footnotes_mode === "study"' class='hint')
    | {{ $t("options.features.study_notes_notice") }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import AppOptionToggle from '@/comp/global/AppOptionToggle.vue'
import {blue} from '@/services/state'
import {useI18n} from '@/services/i18n'

const {t} = useI18n()

// Footnotes and study notes are mutually exclusive (a study-notes resource replaces
// translator footnotes entirely — see bible_content.ts), so a single 3-way toggle replaces
// what used to be two separate checkboxes that could both be ticked at once
const footnotes_mode_items = computed(() => [
    {value: 'none', title: t("common.none")},
    {value: 'footnotes', title: t("options.features.footnotes")},
    {value: 'study', title: t("options.features.study_notes")},
])

// Wrap show_footnotes/notes as a single string so the toggle has one value to bind to
const footnotes_mode = computed({
    get(){
        if (blue.notes){
            return 'study'
        }
        return blue.show_footnotes ? 'footnotes' : 'none'
    },
    set(value:string){
        blue.show_footnotes = value === 'footnotes'
        blue.notes = value === 'study' ? 'eng_tyndale' : null
    },
})

// How to present passage titles
const passage_title_items = computed(() => [
    {value: 'null', title: t("common.none")},
    {value: 'heading', title: t("options.layout.show_as_heading")},
    {value: 'titlepage', title: t("options.layout.show_as_title_page")},
])

// Wrap passage_title so the toggle works with string values (null isn't a valid option value)
const passage_title = computed({
    get: () => String(blue.passage_title),
    set: value => {
        blue.passage_title = value === 'null' ? null : (value as 'titlepage'|'heading')
    },
})

</script>
