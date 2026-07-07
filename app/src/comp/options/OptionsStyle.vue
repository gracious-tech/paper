
<template lang='pug'>

v-select(v-model='blue.font_text' :items='font_items' :label='$t("Font for text")' class='mb-4')

v-select(v-model='blue.font_headings' :items='font_items_auto' :label='$t("Font for headings")'
    class='mb-4')

//- NOTE Allow large font for users with poor eyesight
v-slider(v-model='blue.font_size' :label='$t("Font size")' :min='6' :max='26' thumb-label
    class='my-4' color='')
div(v-if='blue.font_size > 15' class='text-body-2 text-red') {{ $t("A large font size may result in too many pages, depending on the amount of text.") }}

v-slider(v-model='blue.line_height' :label='$t("Line height")' :min='1' :max='4' thumb-label
    class='my-4' color='')

v-radio-group(v-model='justify' inline :label='$t("Justify")' class='my-4')
    v-radio(value='null' :label='$t("Auto")')
    v-radio(value='true' :label='$t("Yes")')
    v-radio(value='false' :label='$t("No")')
p(class='text-body-2 text-disabled') {{$t("Auto will not justify when width is too narrow")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'

import {blue} from '@/services/state'
import {font_items, font_items_with_auto} from '@/services/fonts'


const {t} = useI18n()


const font_items_auto = font_items_with_auto(t)

const justify = computed({
    get: () => String(blue.justify),
    set: value => {
        blue.justify = value === 'null' ? null : (value === 'true')
    },
})


</script>


<style lang='sass' scoped>



</style>
