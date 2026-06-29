<template lang='pug'>

div(class='d-flex align-center')
    v-checkbox(v-model='blue.show_chapters' :label='$t("Chapter numbers")')
    v-select.ch_style(v-model='blue.show_chapters_style' :items='chapter_styles'
        :disabled='!blue.show_chapters' density='compact' variant='outlined')
v-checkbox(v-model='blue.show_verses' :label='$t("Verse numbers")')
v-checkbox(v-model='blue.show_pages' :label='$t("Page numbers")')
v-checkbox(v-model='blue.show_headings' :label='$t("Section headings")')
v-checkbox(v-model='blue.show_footnotes' :label='$t("Footnotes")')
v-checkbox(v-model='blue.show_woj' :disabled='!supports_woj' :label='woj_label')
v-checkbox(v-model='blue.show_lines' :label='$t("Blank pages have lines for notetaking")')
//- v-checkbox(v-model='blue.show_book_name' :label='$t("Book name in footer")')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'

import {blue, supports_woj} from '@/services/state'

const {t} = useI18n()

// Label for the words-of-Jesus toggle, flagging when no chosen translation supports it
const woj_label = computed(() => {
    return supports_woj.value
        ? t(`Color Jesus' words (if bible supports it)`)
        : t(`Color Jesus' words (N/A in chosen translations)`)
})

const chapter_styles = [
    {value: 'divider', title: t("Divider") + " / --- 2 ---"},
    {value: 'float', title: t("Large font") + " / 2"},
    {value: 'heading', title: t("Heading / Chapter") + " 2"},
]


</script>


<style lang='sass' scoped>

.ch_style
    line-height: 1
    margin-left: 24px
    :deep() .v-field__field
        align-items: center
        .v-field__input
            padding-top: 4px
            padding-bottom: 4px
            min-height: 0

</style>
