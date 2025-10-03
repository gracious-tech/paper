
<template lang='pug'>

v-radio-group(v-model='blue.page_arrangement' :label='$t("Arrangement of pages")')
    v-radio(value='booklet' :label='$t("Booklet (fold at home)")')
    v-radio(value='book' :label='$t("Sequential (print professionally)")')
    v-radio(value='normal' :label='$t("Sequential without blank pages (digital use)")')

p(v-if='blue.page_arrangement === "booklet"' class='text-body-2 text-secondary') {{ $t("Two pages will appear on each side of paper and will only appear in the correct order once the whole booklet has been folded.") }}
p(v-else-if='blue.page_arrangement === "book"' class='text-body-2 text-secondary') {{ $t("Pages are in correct order, as expected by professional printing services. Each page will match the paper size setting so ensure it is correct for the size of book you are printing.") }}
p(v-else-if='blue.page_arrangement === "normal"' class='text-body-2 text-red') {{ $t("This is not usually recommended for printing as some pages that should be pairs may go across a page turn. This also overrides any other blank page settings.") }}

div(class='d-flex align-center ml-2 mt-6')
    span(class='mr-4 text-medium-emphasis') {{ $t("Margins") }}
    v-radio-group(v-model='blue.margin_unit' inline)
        v-radio(value='mm' label="mm")
        v-radio(value='in' label="inches")

div(class='d-flex align-center ml-2 my-4')
    v-text-field(v-model='blue.margin_top' variant='underlined' density='compact'
        :label='$t("Top")' class='mr-4')
    v-text-field(v-model='blue.margin_bottom' variant='underlined' density='compact'
        :label='$t("Bottom")' class='mr-4')
    v-text-field(v-model='blue.margin_left' variant='underlined' density='compact'
        :label='$t("Left")' class='mr-4')
    v-text-field(v-model='blue.margin_right' variant='underlined' density='compact'
        :label='$t("Right")' class='mr-4')
div(class='ml-2 my-6')
    v-text-field(v-model='blue.column_gap' variant='underlined' density='compact'
        :label='$t("Column gap")' class='mr-4' style='max-width: 90px')

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'


</script>


<style lang='sass' scoped>



</style>
