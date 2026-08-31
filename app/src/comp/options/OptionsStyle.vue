
<template lang='pug'>

AppFontSelect(v-model='blue.font_text' :label='$t("options.style.text_font")' example='verse'
    class='mb-4')

//- NOTE Allow large font for users with poor eyesight
v-slider(v-model='blue.font_size' :label='$t("common.font_size")' :min='6' :max='26' thumb-label
    class='my-4')
div(v-if='blue.font_size > 15' class='text-body-medium text-red') {{ $t("options.style.large_font_note") }}

v-slider(v-model='blue.line_height' :label='$t("options.style.line_height")' :min='1' :max='4' thumb-label
    class='my-4')

v-radio-group(v-model='justify' inline :label='$t("options.style.justify")' class='my-4')
    v-radio(value='null' :label='$t("common.auto")')
    v-radio(value='true' :label='$t("common.yes")')
    v-radio(value='false' :label='$t("common.no")')
p(class='text-body-medium text-disabled') {{$t("options.style.justify_auto_note")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue} from '@/services/state'

const justify = computed({
    get: () => String(blue.justify),
    set: value => {
        blue.justify = value === 'null' ? null : (value === 'true')
    },
})

</script>


<style lang='sass' scoped>



</style>
