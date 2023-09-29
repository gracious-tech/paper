
<template lang='pug'>

//- v-select(v-model='blue.font_family' :items='fonts' label="Font family")
v-slider(v-model='blue.font_size' label="Font size" :min='6' :max='18' thumb-label class='my-4')
v-slider(v-model='blue.line_height' label="Line height" :min='1' :max='4' thumb-label class='my-4')

v-radio-group(v-model='justify' inline label="Justify" class='my-4')
    v-radio(value='null' label="Auto")
    v-radio(value='true' label="Yes")
    v-radio(value='false' label="No")
p(class='text-body-2 text-disabled') Auto will not justify when width is too narrow

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue} from '@/services/state'


const fonts = ["Crimson Pro", "Libre Baskerville", "Libre Caslon Text", "EB Garamond"]

const justify = computed({
    get: () => String(blue.justify),
    set: value => {
        blue.justify = value === 'null' ? null : (value === 'true')
    },
})


</script>


<style lang='sass' scoped>



</style>
