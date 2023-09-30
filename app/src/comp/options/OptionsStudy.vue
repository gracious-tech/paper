
<template lang='pug'>

//- v-radio-group(v-model='state.crossref' inline label="Cross-references")
//-     v-radio(:value='null' label="None")
//-     v-radio(value='small' label="Most relevant")
//-     v-radio(value='medium' label="All available")

v-checkbox(v-model='notes' label="Tyndale Open Study Notes"
    :disabled='translation_forbids_derivatives' :error-messages='forbidden' :hide-details='false')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue, translation_forbids_derivatives} from '@/services/state'


const notes = computed({
    get(){
        return blue.notes !== null && !translation_forbids_derivatives.value
    },
    set(value:boolean){
        blue.notes = value ? 'eng_tyndale' : null
    },
})

const forbidden = computed(() => {
    if (translation_forbids_derivatives.value){
        return "Chosen Bible translation does not allow adding content such as study notes"
    }
    return ""
})


</script>


<style lang='sass' scoped>



</style>
