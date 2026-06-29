<template lang='pug'>

v-list(bg-color='transparent')
    v-list-item(@click='apply_general_preset')
        v-list-item-title {{$t("Standard Bible")}}
        v-list-item-subtitle {{$t("How most bibles look, with verse numbers and headings")}}
    v-list-item(@click='apply_study_preset')
        v-list-item-title {{$t("Study Bible")}}
        v-list-item-subtitle {{$t("Extensive footnotes to guide readers")}}
    v-list-item(@click='apply_reading_preset')
        v-list-item-title {{$t("Reading Bible")}}
        v-list-item-subtitle {{$t("No verse numbers, like a normal book")}}
    v-list-item(@click='apply_writing_preset')
        v-list-item-title {{$t("Notetaking Bible")}}
        v-list-item-subtitle {{$t("Lots of space to write notes")}}

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'


const apply_general_preset = () => {
    blue.show_headings = true
    blue.show_chapters = true
    blue.show_verses = true
    blue.show_footnotes = true
    blue.notes = null
    blue.line_height = 1.75
    blue.half_blank = null
}

const apply_reading_preset = () => {
    blue.show_headings = false
    blue.show_chapters = false
    blue.show_verses = false
    blue.show_footnotes = false
    blue.notes = null
    blue.line_height = 1.75
    blue.half_blank = null
}

const apply_writing_preset = () => {
    blue.show_headings = true
    blue.show_chapters = true
    blue.show_verses = true
    blue.show_footnotes = false
    blue.notes = null
    blue.line_height = 2.5
    blue.half_blank = 'right'
    blue.bibles_layout = 'columns'  // Required for half_blank
}

const apply_study_preset = () => {
    blue.show_headings = true
    blue.show_chapters = true
    blue.show_verses = true
    blue.show_footnotes = false
    blue.notes = 'eng_tyndale'
    blue.line_height = 1.5
    blue.half_blank = null
}


</script>


<style lang='sass' scoped>

.v-list-item
    min-height: 60px

</style>
