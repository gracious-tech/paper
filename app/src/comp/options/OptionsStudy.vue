
<template lang='pug'>

v-checkbox(v-model='notes' label="Tyndale Open Study Notes" :hide-details='false')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue} from '@/services/state'


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
