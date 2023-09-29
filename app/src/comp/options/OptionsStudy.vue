
<template lang='pug'>

//- v-radio-group(v-model='state.crossref' inline label="Cross-references")
//-     v-radio(:value='null' label="None")
//-     v-radio(value='small' label="Most relevant")
//-     v-radio(value='medium' label="All available")

v-checkbox(v-model='notes' label="Tyndale Open Study Notes")

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue, state} from '@/services/state'


const notes = computed({
    get(){
        return blue.notes !== null
    },
    set(value:boolean){
        blue.notes = value ? 'eng_tyndale' : null
    },
})


</script>


<style lang='sass' scoped>



</style>
