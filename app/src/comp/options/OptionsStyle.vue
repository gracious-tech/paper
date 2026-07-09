
<template lang='pug'>

AppFontSelect(v-model='blue.font_text' :label='$t("Font for text")' example='verse'
    class='mb-4')

AppFontSelect(v-if='blue.bibles.length > 1' v-model='blue.font_text2'
    :label='$t("Font for second translation")' auto example='verse' class='mb-4')

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

v-btn(@click='advanced' variant='tonal' color='primary' class='mt-4') {{$t("Advanced styles")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue, state} from '@/services/state'

const justify = computed({
    get: () => String(blue.justify),
    set: value => {
        blue.justify = value === 'null' ? null : (value === 'true')
    },
})


// Open the advanced styles editor (headings, text color)
const advanced = () => {
    state.editor = {
        component: 'EditorAdvancedStyles',
        props: {},
    }
}


</script>


<style lang='sass' scoped>



</style>
