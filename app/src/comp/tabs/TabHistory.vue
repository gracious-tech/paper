
<template lang='pug'>

div(v-if='!creations.length' class='pa-4 pt-10 text-center') {{$t("No creations (yet)")}}

v-list(v-else ref='list_comp' bg-color='transparent' class='flex-grow-1')
    TabHistoryItem(v-for='creation of creations_sorted' :creation='creation')

div(class='text-body-2 text-center pa-4 text-medium-emphasis') ({{$t("creations expire after 1 year and if browser history cleared")}})

</template>


<script lang='ts' setup>

import {computed, ref, watch, nextTick} from 'vue'

import {creations, state} from '@/services/state'
import TabHistoryItem from './assets/TabHistoryItem.vue'

import type {VList} from 'vuetify/components/VList'


const list_comp = ref<VList>()


const creations_sorted = computed(() => {
    return [...creations].sort((a, b) => b.created.getTime() - a.created.getTime())
})


watch(() => state.tab, () => {
    // Always reset scroll to top whenever go to history tab, as new items appear there
    if (state.tab === 'history'){
        nextTick(() => {
            ;(list_comp.value?.$el as HTMLDivElement|undefined)?.scroll({top: 0})
        })
    }
})


</script>


<style lang='sass' scoped>

</style>
