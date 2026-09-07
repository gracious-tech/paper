
<template lang='pug'>

AppFontSelect(v-model='blue.font_text' :label='$t("options.style.text_font")' example='verse'
    class='mb-4')

//- NOTE Allow large font for users with poor eyesight
v-slider(v-model='blue.font_size' :label='$t("common.font_size")' :min='6' :max='26' thumb-label
    class='mt-4')
p(v-if='blue.font_size > 15' class='hint text-error') {{ $t("options.style.large_font_note") }}

v-slider(v-model='blue.line_height' :label='$t("options.style.line_height")' :min='1' :max='4' thumb-label
    class='my-4')

AppOptionToggle(v-model='justify' :label='$t("options.style.justify")' :items='justify_items'
    class='mt-4')
p(class='hint') {{$t("options.style.justify_auto_note")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import {blue} from '@/services/state'


const {t} = useI18n()


// Justify options — string-valued so the toggle can carry the null ("auto") choice
const justify_items = computed(() => [
    {value: 'null', title: t("common.auto")},
    {value: 'true', title: t("common.yes")},
    {value: 'false', title: t("common.no")},
])


// Wrap justify so the toggle works with string values (null isn't a valid option value)
const justify = computed({
    get: () => String(blue.justify),
    set: value => {
        blue.justify = value === 'null' ? null : (value === 'true')
    },
})

</script>


<style lang='sass' scoped>



</style>
