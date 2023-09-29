
<template lang='pug'>

div(class='d-flex align-center')
    v-checkbox(v-model='blue.show_chapters' label="Chapter numbers")
    v-select.ch_style(v-model='blue.show_chapters_style' :items='chapter_styles'
        :disabled='!blue.show_chapters' density='compact' variant='outlined')
v-checkbox(v-model='blue.show_verses' label="Verse numbers")
v-checkbox(v-model='blue.show_headings' label="Section headings")
v-checkbox(v-model='blue.show_footnotes' label="Footnotes")
v-checkbox(v-model='blue.show_woj' label="Color Jesus' words (if bible supports it)")
v-checkbox(v-model='blue.show_lines' label="Blank pages have lines for notetaking")
//- v-checkbox(v-model='blue.show_pages' label="Page numbers")
//- v-checkbox(v-model='blue.show_book_name' label="Book name in footer")

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'

const chapter_styles = [
    {value: 'divider', title: "Divider / --- 2 ---"},
    {value: 'float', title: "Large font / 2"},
    {value: 'heading', title: "Heading / Chapter 2"},
]


</script>


<style lang='sass' scoped>

.ch_style
    line-height: 1
    width: 150px
    :deep() .v-field__field
        align-items: center
        .v-field__input
            padding-top: 4px
            padding-bottom: 4px
            min-height: 0

</style>
