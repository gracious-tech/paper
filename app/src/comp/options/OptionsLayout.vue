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

div(class='d-flex align-center ml-2')
    span(class='mr-4 text-medium-emphasis') {{ $t("options.layout.margins") }}

div(class='d-flex align-center ml-2 my-4')
    v-text-field(v-model.number='blue.margin_top' type='number' variant='underlined' density='compact'
        :label='$t("common.top")' class='mr-4')
    v-text-field(v-model.number='blue.margin_bottom' type='number' variant='underlined' density='compact'
        :label='$t("common.bottom")' class='mr-4')
    v-text-field(v-model.number='blue.margin_inner' type='number' variant='underlined' density='compact'
        :label='$t("options.layout.inner")' class='mr-4')
    v-text-field(v-model.number='blue.margin_outer' type='number' variant='underlined' density='compact'
        :label='$t("options.layout.outer")' class='mr-4')
div(class='ml-2 my-6 d-flex')
    v-text-field(v-model.number='blue.column_gap' type='number' variant='underlined' density='compact'
        :label='$t("options.layout.column_gap")' class='mr-4' style='max-width: 90px'
        :disabled='blue.columns === false')
    v-radio-group(v-model='margin_unit' inline)
        v-radio(value='mm' label="mm")
        v-radio(value='in' label="inches")

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


// Wrap margin_unit so switching mm/inches converts existing margin values rather than
// leaving the numbers as-is (which would otherwise become nonsensically small/large)
const margin_unit = computed({
    get: () => blue.margin_unit,
    set: value => {
        if (value === blue.margin_unit) {
            return
        }
        const factor = value === 'in' ? 1 / 25.4 : 25.4
        const round = (num:number) => Math.round(num * 100) / 100
        blue.margin_top = round(blue.margin_top * factor)
        blue.margin_bottom = round(blue.margin_bottom * factor)
        blue.margin_inner = round(blue.margin_inner * factor)
        blue.margin_outer = round(blue.margin_outer * factor)
        blue.column_gap = round(blue.column_gap * factor)
        blue.margin_unit = value
    },
})


</script>


<style lang='sass' scoped>



</style>
