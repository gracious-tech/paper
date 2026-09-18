<template lang='pug'>

AppOptionToggle(v-model='blue.bibles_layout' :label='$t("options.layout.multi_translation")'
    :items='layout_items' :disabled='blue.bibles.length < 2' class='my-6')

AppOptionToggle(v-model='blue.bibles_align' :label='$t("options.layout.align_by")'
    :items='align_items' :disabled='blue.bibles.length < 2' class='my-6')

AppOptionToggle(v-model='columns' :label='$t("options.layout.columns")' :items='columns_items'
    :disabled='blue.bibles_layout === "columns" && blue.bibles.length > 1' class='mt-4')
p(class='hint') {{ $t("options.layout.columns_auto_note") }}

AppOptionToggle(v-model='half_blank' :label='$t("options.layout.half_blank")'
    :items='half_blank_items'
    :disabled='blue.bibles.length > 1 && blue.bibles_layout === "alternate"' class='my-6')

AppOptionToggle(v-model='passage_title' :label='$t("options.layout.passage_titles")'
    :items='passage_title_items' class='my-6')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import {blue} from '@/services/state'


const {t} = useI18n()


// Multi-translation layout options
const layout_items = computed(() => [
    {value: 'columns', title: t("options.layout.separate_columns")},
    {value: 'alternate', title: t("options.layout.separate_pages")},
])


// Alignment granularity when showing translations side by side
const align_items = computed(() => [
    {value: 'verse', title: t("options.layout.verse")},
    {value: 'paragraph', title: t("options.layout.paragraph")},
    {value: 'chapter', title: t("options.layout.chapter")},
])


// Column-count options — string-valued so the toggle can carry the null ("auto") choice
const columns_items = computed(() => [
    {value: 'null', title: t("common.auto")},
    {value: 'false', title: t("common.one")},
    {value: 'true', title: t("common.two")},
])


// Which side (if any) to leave blank for notetaking
const half_blank_items = computed(() => [
    {value: 'null', title: t("common.none")},
    {value: 'left', title: t("common.left")},
    {value: 'right', title: t("common.right")},
])


// How to present passage titles
const passage_title_items = computed(() => [
    {value: 'null', title: t("common.none")},
    {value: 'heading', title: t("options.layout.show_as_heading")},
    {value: 'titlepage', title: t("options.layout.show_as_title_page")},
])


// Wrap columns so the toggle works with string values (null isn't a valid option value)
const columns = computed({
    get: () => String(blue.columns),
    set: value => {
        blue.columns = value === 'null' ? null : (value === 'true')
    },
})


// Wrap half_blank so the toggle works with string values (null isn't a valid option value)
const half_blank = computed({
    get: () => String(blue.half_blank),
    set: value => {
        blue.half_blank = value === 'null' ? null : (value as 'left'|'right')
    },
})


// Wrap passage_title so the toggle works with string values (null isn't a valid option value)
const passage_title = computed({
    get: () => String(blue.passage_title),
    set: value => {
        blue.passage_title = value === 'null' ? null : (value as 'titlepage'|'heading')
    },
})


</script>


<style lang='sss' scoped>



</style>
