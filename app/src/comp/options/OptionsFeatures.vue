<template lang='pug'>

v-checkbox(v-model='blue.show_chapters' :label='$t("common.chapter_numbers")')
v-checkbox(v-model='blue.show_verses' :label='$t("options.features.verse_numbers")')
v-checkbox(v-model='blue.running_pages' :label='$t("options.features.page_numbers")')
v-checkbox(v-model='blue.running_headings' :label='$t("options.features.book_chapter_name")')
v-checkbox(v-model='blue.show_headings' :label='$t("options.features.section_headings")')
v-checkbox(v-model='blue.show_footnotes' :label='$t("options.features.footnotes")')
v-checkbox(v-model='blue.show_lines' :label='$t("options.features.blank_page_lines")')
v-checkbox(v-model='blue.show_wj' :disabled='!supports_wj' :label='wj_label')
div(v-if='blue.show_wj && supports_wj' class='wj_style')
    AppColor(v-model='blue.show_wj_color' :label="$t(`options.features.wj_color_label`)")
    v-checkbox(v-model='blue.show_wj_bold' :label='$t("common.bold")' density='compact' hide-details)
    v-checkbox(v-model='blue.show_wj_italic' :label='$t("common.italic")' density='compact' hide-details)

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import {blue, supports_wj} from '@/services/state'

const {t} = useI18n()

// Label for the words-of-Jesus toggle, flagging when no chosen translation supports it
const wj_label = computed(() => {
    return supports_wj.value
        ? t(`options.features.wj_color`)
        : t(`options.features.wj_color_na`)
})


</script>


<style lang='sass' scoped>

.wj_style
    display: flex
    align-items: center
    flex-wrap: wrap
    gap: 16px
    margin-left: 40px
    margin-bottom: 8px

</style>
