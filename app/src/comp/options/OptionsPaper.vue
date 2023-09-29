
<template lang='pug'>

v-radio-group(v-model='paper' inline)
    v-radio(value='a4' label="A4")
    v-radio(value='letter' label="US Letter")
    v-radio(value='other' label="Other")

div(v-if='paper === "other"' class='d-flex align-center ml-2 mb-4')
    v-text-field(v-model='blue.paper_width' variant='underlined' density='compact' suffix="W" class='mr-4')
    v-text-field(v-model='blue.paper_height' variant='underlined' density='compact' suffix="H" class='mr-4')
    v-radio-group(v-model='blue.paper_unit' inline)
        v-radio(value='mm' label="mm")
        v-radio(value='in' label="inches")

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'

import {blue} from '@/services/state'


const paper = ref<'a4'|'letter'|'other'>('other')
if (blue.paper_unit === 'mm' && blue.paper_width === 210 && blue.paper_height === 297){
    paper.value = 'a4'
} else if (blue.paper_unit === 'in' && blue.paper_width === 8.5 && blue.paper_height === 11){
    paper.value = 'letter'
}

watch(paper, () => {
    if (paper.value === 'a4'){
        blue.paper_unit = 'mm'
        blue.paper_width = 210
        blue.paper_height = 297
    } else if (paper.value === 'letter'){
        blue.paper_unit = 'in'
        blue.paper_width = 8.5
        blue.paper_height = 11
    }
})


</script>


<style lang='sass' scoped>



</style>
