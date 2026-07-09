
<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("Advanced styles")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='overflow-y-auto')

    h3(class='text-h6 mb-4') {{$t("Headings")}}

    AppFontSelect(v-model='blue.font_headings' :label='$t("Font for headings")' auto
        example='heading' class='mb-4')

    v-checkbox(v-model='blue.show_headings_bold' :label='$t("Bold")')
    v-checkbox(v-model='blue.show_headings_italic' :label='$t("Italic")')

    v-slider(v-model='blue.show_headings_size' :label='$t("Size")' :min='0.8' :max='2'
        :step='0.05' thumb-label class='my-4' color='')
    p(class='text-body-2 text-medium-emphasis') {{$t("Size is relative to normal text, with 1 being the same size.")}}

    v-divider(class='my-8')

    h3(class='text-h6 mb-4') {{$t("Text color")}}

    AppColor(v-model='blue.text_color' :label='$t("Color of text")')
    p(class='text-body-2 text-medium-emphasis mt-2') {{$t("It's not recommended to use this setting unless you have eyesight issues that require it.")}}

</template>


<script lang='ts' setup>

import {blue, state} from '@/services/state'


// Close the editor
const done = () => {
    state.editor = null
}

</script>


<style lang='sass' scoped>

.v-card-text
    padding-bottom: 30vh

</style>
