
<template lang='pug'>

div(v-if='!creations.length' class='pa-4 pt-10 text-center') No creations (yet)

v-list(v-else ref='list_comp' bg-color='transparent')
    v-list-item(v-for='creation of creations_sorted' @click='select(creation)'
            :active='creation.request_id === selected_id' color='secondary')
        v-list-item-title {{ creation.blueprint.title }}
        v-list-item-subtitle {{ creation.created.toLocaleString() }}
        template(#append)
            v-badge(v-if='creation.pages' :content='Math.ceil(creation.pages / 2)' inline
                :color='pages_to_color(creation.pages)' title="Paper required" class='mr-3')
            v-progress-circular(v-if='creation.status === "pending"' indeterminate size='32'
                color='secondary')
            v-btn(v-else-if='creation.status === "failed"' icon variant='text' color='error')
                app-icon(name='error')
            v-btn(v-else @click='() => download(creation)' icon variant='text')
                app-icon(name='download')

</template>


<script lang='ts' setup>

import {computed, ref, watch, nextTick} from 'vue'

import {creations, selected_id, state} from '@/services/state'
import {gen_creation_url} from '@/services/backend'

import type {VList} from 'vuetify/components/VList'
import type {Creation} from '@/services/types'


const list_comp = ref<VList>()


const creations_sorted = computed(() => {
    return [...creations].sort((a, b) => b.created.getTime() - a.created.getTime())
})


const pages_to_color = (num:number) => {
    const paper = Math.ceil(num / 2)
    if (paper > 20){
        return 'red'
    } else if (paper > 15){
        return 'orange'
    }
    return 'green'
}


const select = (creation:Creation) => {
    selected_id.value = creation.request_id
}

const download = (creation:Creation) => {
    self.open(gen_creation_url(creation.creation_id!, 'pdf'), '_blank')
}

watch(() => state.tab, () => {
    // Always reset scroll to top whenever go to history tab, as new items appear there
    if (state.tab === 'history'){
        nextTick(() => {
            ;(list_comp.value!.$el as HTMLDivElement).scroll({top: 0})
        })
    }
})


</script>


<style lang='sass' scoped>

.v-list
    padding-bottom: 30vh

.v-progress-circular
    margin: 8px

</style>
