
<template lang='pug'>

v-list-item(@click='select' :active='creation.request_id === selected_id' color='primary')
    v-list-item-title {{ creation.blueprint.title }}
    v-list-item-subtitle {{ creation.created.toLocaleString() }}
    template(#append)
        div.status
            v-badge(v-if='creation.status === "available"' :content='paper_count'
                :color='pages_color' :title='$t("Sheets of paper required to print")' inline)
            v-progress-circular(v-else-if='creation.status === "pending"' indeterminate size='32'
                color='secondary')
            app-icon(v-else-if='creation.status === "failed"' name='error' class='text-error')
        v-menu
            template(#activator='{props}')
                v-btn(v-bind='props' icon variant='text' color='black')
                    app-icon(name='more_vert')
            v-list
                v-list-item(@click='download' :disabled='creation.status !== "available"')
                    v-list-item-title {{$t("Open")}}
                v-list-item(@click='edit')
                    v-list-item-title {{$t("Edit as new")}}
                v-list-item(@click='remove' :disabled='creation.status === "pending"')
                    v-list-item-title {{$t("Delete")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {creations, selected_id, state, blue} from '@/services/state'
import {clean_blueprint} from '@/services/blueprints'

import type {Creation} from '@/services/types'


const props = defineProps<{creation:Creation}>()


const paper_count = computed(() => {
    return Math.ceil(props.creation.pages! / 2)
})


const pages_color = computed(() => {
    if (!props.creation.blueprint.booklet){
        return 'grey'
    }
    if (paper_count.value > 20){
        return 'red'
    } else if (paper_count.value > 15){
        return 'orange'
    }
    return 'green'
})


const select = () => {
    selected_id.value = props.creation.request_id
}

const download = () => {
    // Open the locally-compiled PDF in a new tab
    if (props.creation.pdf_url){
        self.open(props.creation.pdf_url, '_blank')
    }
}

const edit = async () => {
    Object.assign(blue, clean_blueprint(props.creation.blueprint))
    state.tab = 'create'
    state.editor = null
}

const remove = async () => {

    // Release the in-memory PDF object URL
    if (props.creation.pdf_url){
        URL.revokeObjectURL(props.creation.pdf_url)
    }

    // Remove from state
    const array_index = creations.findIndex(c => c.request_id === props.creation.request_id)
    if (array_index !== -1){
        creations.splice(array_index, 1)
    }
}


</script>


<style lang='sass' scoped>

.status
    width: 48px
    display: inline-flex
    justify-content: center
    align-items: center

.v-progress-circular
    margin: 8px

</style>
