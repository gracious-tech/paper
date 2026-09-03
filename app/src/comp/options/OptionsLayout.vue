<template lang='pug'>

v-radio-group(v-model='blue.bibles_layout' inline :label='$t("options.layout.multi_translation")'
        :disabled='blue.bibles.length < 2' class='my-6')
    v-radio(value='columns' :label='$t("options.layout.separate_columns")')
    v-radio(value='alternate' :label='$t("options.layout.separate_pages")')

v-radio-group(v-model='blue.bibles_align' inline :label='$t("options.layout.align_by")'
        :disabled='blue.bibles.length < 2' class='my-6')
    v-radio(value='verse' :label='$t("options.layout.verse")')
    v-radio(value='paragraph' :label='$t("options.layout.paragraph")')
    v-radio(value='chapter' :label='$t("options.layout.chapter")')

v-radio-group(v-model='columns' inline :label='$t("options.layout.columns")' class='my-4'
        :disabled='blue.bibles_layout === "columns" && blue.bibles.length > 1')
    v-radio(value='null' :label='$t("common.auto")')
    v-radio(value='false' :label='$t("common.one")')
    v-radio(value='true' :label='$t("common.two")')
p(class='text-body-medium text-disabled') {{ $t("options.layout.columns_auto_note") }}

v-radio-group(v-model='half_blank' inline :label='$t("options.layout.half_blank")'
        :disabled='blue.bibles.length > 1 && blue.bibles_layout === "alternate"' class='my-6')
    v-radio(value='null' :label='$t("common.none")')
    v-radio(value='left' :label='$t("common.left")')
    v-radio(value='right' :label='$t("common.right")')

v-radio-group(v-model='passage_title' inline
        :label='$t("options.layout.passage_titles")' class='my-6')
    v-radio(value='null' :label='$t("common.none")')
    v-radio(value='heading' :label='$t("options.layout.show_as_heading")')
    v-radio(value='titlepage' :label='$t("options.layout.show_as_title_page")')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue} from '@/services/state'


const columns = computed({
    get: () => String(blue.columns),
    set: value => {
        blue.columns = value === 'null' ? null : (value === 'true')
    },
})


// Wrap half_blank so the radio group can use string values (null isn't a valid radio value)
const half_blank = computed({
    get: () => String(blue.half_blank),
    set: value => {
        blue.half_blank = value === 'null' ? null : (value as 'left'|'right')
    },
})


// Wrap passage_title so the radio group can use string values (null isn't a valid radio value)
const passage_title = computed({
    get: () => String(blue.passage_title),
    set: value => {
        blue.passage_title = value === 'null' ? null : (value as 'titlepage'|'heading')
    },
})


</script>


<style lang='sass' scoped>



</style>
