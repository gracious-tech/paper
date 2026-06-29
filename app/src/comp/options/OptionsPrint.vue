
<template lang='pug'>

div(class='d-flex align-center ml-2')
    span(class='mr-4 text-medium-emphasis') {{ $t("Margins") }}
    v-radio-group(v-model='blue.margin_unit' inline)
        v-radio(value='mm' label="mm")
        v-radio(value='in' label="inches")

div(class='d-flex align-center ml-2 my-4')
    v-text-field(v-model='blue.margin_top' variant='underlined' density='compact'
        :label='$t("Top")' class='mr-4')
    v-text-field(v-model='blue.margin_bottom' variant='underlined' density='compact'
        :label='$t("Bottom")' class='mr-4')
    v-text-field(v-model='blue.margin_inner' variant='underlined' density='compact'
        :label='$t("Inner")' class='mr-4')
    v-text-field(v-model='blue.margin_outer' variant='underlined' density='compact'
        :label='$t("Outer")' class='mr-4')
div(class='ml-2 my-6')
    v-text-field(v-model='blue.column_gap' variant='underlined' density='compact'
        :label='$t("Column gap")' class='mr-4' style='max-width: 90px'
        :disabled='blue.columns === false')

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'


</script>


<style lang='sass' scoped>



</style>
