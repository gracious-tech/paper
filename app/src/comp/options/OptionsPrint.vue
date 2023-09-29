
<template lang='pug'>

v-radio-group(v-model='blue.page_arrangement' class='mb-6')
    v-radio(value='booklet' label="Booklet (2 pages per side, ordered for folding)")
    v-radio(value='normal' label="Regular (1 page per side, ordered sequentially)")

div(class='d-flex align-center ml-2')
    span(class='mr-4 text-medium-emphasis') Margins
    v-radio-group(v-model='blue.margin_unit' inline)
        v-radio(value='mm' label="mm")
        v-radio(value='in' label="inches")

div(class='d-flex align-center ml-2 my-4')
    v-text-field(v-model='blue.margin_top' variant='underlined' density='compact' label="Top" class='mr-4')
    v-text-field(v-model='blue.margin_bottom' variant='underlined' density='compact' label="Bottom" class='mr-4')
    v-text-field(v-model='blue.margin_left' variant='underlined' density='compact' label="Left" class='mr-4')
    v-text-field(v-model='blue.margin_right' variant='underlined' density='compact' label="Right" class='mr-4')

div(class='ml-2 my-6')
    v-text-field(v-model='blue.column_gap' variant='underlined' density='compact' label="Column gap" class='mr-4' style='max-width: 90px')

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'


</script>


<style lang='sass' scoped>



</style>
