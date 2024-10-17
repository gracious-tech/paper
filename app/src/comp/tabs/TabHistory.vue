
<template lang='pug'>

div(v-if='!creations.length' class='pa-4 pt-10 text-center') No creations (yet)

v-list(v-else ref='list_comp' bg-color='transparent' class='flex-grow-1')
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
            v-menu
                template(#activator='{props}')
                    app-icon(name='more_vert' v-bind='props')
                v-list
                    v-list-item(@click='() => edit(creation)')
                        v-list-item-title Edit as new
                    v-list-item(@click='() => remove(creation)' :disabled='creation.status === "pending"')
                        v-list-item-title Delete

div(class='text-body-2 text-center pa-4 text-medium-emphasis') (creations expire after 1 year and if browser history cleared)

</template>


<script lang='ts' setup>

import {computed, ref, watch, nextTick} from 'vue'
import {cloneDeep} from 'lodash-es'

import {creations, selected_id, state, blue} from '@/services/state'
import {delete_creation, gen_creation_url} from '@/services/backend'
import {database} from '@/services/db'

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

const edit = async (creation:Creation) => {
    Object.assign(blue, cloneDeep(creation.blueprint))
    state.tab = 'create'
    state.editor = null
}

const remove = async (creation:Creation) => {

    // NOTE Failed creations won't have a creation_id
    if (creation.creation_id){
        await delete_creation(creation.creation_id)
    }

    // Remove from database and state if successfully removed from server
    await database.creations_delete(creation)
    const array_index = creations.findIndex(c => c.request_id === creation.request_id)
    if (array_index !== -1){
        creations.splice(array_index, 1)
    }
}

watch(() => state.tab, () => {
    // Always reset scroll to top whenever go to history tab, as new items appear there
    if (state.tab === 'history'){
        nextTick(() => {
            ;(list_comp.value?.$el as HTMLDivElement).scroll({top: 0})
        })
    }
})


</script>


<style lang='sass' scoped>

.v-progress-circular
    margin: 8px

</style>
