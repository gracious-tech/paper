
<template lang='pug'>

v-list-item(@click='select' :active='creation.request_id === selected_id'
        color='secondary')
    v-list-item-title {{ creation.blueprint.title }}
    v-list-item-subtitle {{ creation.created.toLocaleString() }}
    template(#append)
        v-badge(v-if='creation.pages' :content='Math.ceil(creation.pages / 2)' inline
            :color='pages_to_color(creation.pages)' title="Paper required" class='mr-3')
        v-progress-circular(v-if='creation.status === "pending"' indeterminate size='32'
            color='secondary')
        v-btn(v-else-if='creation.status === "failed"' icon variant='text' color='error')
            app-icon(name='error')
        v-btn(v-else @click='download' icon variant='text')
            app-icon(name='download')
        v-menu
            template(#activator='{props}')
                app-icon(name='more_vert' v-bind='props')
            v-list
                v-list-item(@click='edit')
                    v-list-item-title Edit as new
                v-list-item(@click='remove' :disabled='creation.status === "pending"')
                    v-list-item-title Delete

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {cloneDeep} from 'lodash-es'

import {creations, selected_id, state, blue} from '@/services/state'
import {delete_creation, gen_creation_url} from '@/services/backend'
import {database} from '@/services/db'

import type {Creation} from '@/services/types'


const props = defineProps<{creation:Creation}>()


const pages_to_color = (num:number) => {
    const paper = Math.ceil(num / 2)
    if (paper > 20){
        return 'red'
    } else if (paper > 15){
        return 'orange'
    }
    return 'green'
}


const select = () => {
    selected_id.value = props.creation.request_id
}

const download = () => {
    self.open(gen_creation_url(props.creation.creation_id!, 'pdf'), '_blank')
}

const edit = async () => {
    Object.assign(blue, cloneDeep(props.creation.blueprint))
    state.tab = 'create'
    state.editor = null
}

const remove = async () => {

    // NOTE Failed creations won't have a creation_id
    if (props.creation.creation_id){
        await delete_creation(props.creation.creation_id)
    }

    // Remove from database and state if successfully removed from server
    await database.creations_delete(props.creation)
    const array_index = creations.findIndex(c => c.request_id === props.creation.request_id)
    if (array_index !== -1){
        creations.splice(array_index, 1)
    }
}


</script>


<style lang='sass' scoped>

.v-progress-circular
    margin: 8px

</style>
