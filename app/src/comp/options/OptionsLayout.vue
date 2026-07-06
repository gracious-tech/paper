<template lang='pug'>

v-radio-group(v-model='blue.bibles_layout' inline :label='$t("Layout for multiple translations")'
        :disabled='blue.bibles.length < 2' class='my-6')
    v-radio(value='columns' :label='$t("Separate columns")')
    v-radio(value='alternate' :label='$t("Separate pages")')

v-radio-group(v-model='columns' inline :label='$t("Columns")' class='my-4'
        :disabled='blue.bibles_layout === "columns" && blue.bibles.length > 1')
    v-radio(value='null' :label='$t("Auto")')
    v-radio(value='false' :label='$t("One")')
    v-radio(value='true' :label='$t("Two")')
p(class='text-body-2 text-disabled') {{ $t("Auto will use two columns only for poetic books") }}

v-radio-group(v-model='half_blank' inline :label='$t("Keep a side blank for notetaking")'
        :disabled='blue.bibles.length > 1 && blue.bibles_layout === "alternate"' class='my-6')
    v-radio(value='null' :label='$t("None")')
    v-radio(value='left' :label='$t("Left")')
    v-radio(value='right' :label='$t("Right")')

div(class='d-flex align-center ml-2')
    span(class='mr-4 text-medium-emphasis') {{ $t("Margins") }}

div(class='d-flex align-center ml-2 my-4')
    v-text-field(v-model='blue.margin_top' variant='underlined' density='compact'
        :label='$t("Top")' class='mr-4')
    v-text-field(v-model='blue.margin_bottom' variant='underlined' density='compact'
        :label='$t("Bottom")' class='mr-4')
    v-text-field(v-model='blue.margin_inner' variant='underlined' density='compact'
        :label='$t("Inner")' class='mr-4')
    v-text-field(v-model='blue.margin_outer' variant='underlined' density='compact'
        :label='$t("Outer")' class='mr-4')
div(class='ml-2 my-6 d-flex')
    v-text-field(v-model='blue.column_gap' variant='underlined' density='compact'
        :label='$t("Column gap")' class='mr-4' style='max-width: 90px'
        :disabled='blue.columns === false')
    v-radio-group(v-model='blue.margin_unit' inline)
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


</script>


<style lang='sass' scoped>



</style>
