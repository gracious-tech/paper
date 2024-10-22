
<template lang='pug'>

v-radio-group(v-model='blue.page_arrangement' label="Arrangement of pages")
    v-radio(value='booklet' label="Booklet (fold at home)")
    v-radio(value='book' label="Sequential (print professionally)")
    v-radio(value='normal' label="Sequential without blank pages (digital use)")

p(v-if='blue.page_arrangement === "booklet"' class='text-body-2 text-secondary') Two pages will appear on each side of paper and will only appear in the correct order once the whole booklet has been folded.
p(v-else-if='blue.page_arrangement === "book"' class='text-body-2 text-secondary') Pages are in correct order, as expected by professional printing services. Each page will match the paper size setting so ensure it is correct for the size of book you are printing.
p(v-else-if='blue.page_arrangement === "normal"' class='text-body-2 text-red') This is not usually recommended for printing as some pages that should be pairs may go across a page turn. This also overrides any other blank page settings.

div(class='d-flex align-center ml-2 mt-6')
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
