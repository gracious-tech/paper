
<template lang='pug'>

iframe(v-if='iframe_src' :src='iframe_src')
div.explain(v-else)
    template(v-if='status === undefined')
    template(v-else-if='status === "pending"')
        h3(class='mb-6') Generating your creation...
        div(class='mb-10')
            | Short documents take seconds, where as large ones may be a few minutes
            |  (max {{ max_minutes }} minutes).
        v-progress-circular(indeterminate color='secondary' size='60' width='6')
    template(v-else-if='status === "failed"')
        h3(class='mb-6') An error occurred
        div
            v-btn(href='https://gracious.tech/support' target='_blank' color='secondary') Contact Us
        p(class='mt-12 mb-3') Please include this code in your email:
        p
            strong {{ debug }}
    template(v-else-if='status === "expired"')
        h3(class='mb-6') PDF has expired
        div
            v-btn(@click='recreate' color='secondary') Recreate

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {cloneDeep} from 'lodash-es'

import {blue, selected_creation, state} from '@/services/state'
import {gen_creation_url} from '@/services/backend'
import {TIMEOUT_SECONDS} from '@/services/create'


const max_minutes = Math.ceil(TIMEOUT_SECONDS / 60)


const status = computed(() => {
    return selected_creation.value?.status
})


const iframe_src = computed(() => {
    if (selected_creation.value?.status === 'available'){
        return gen_creation_url(selected_creation.value.creation_id!, 'pdf')
    }
    return null
})


const debug = computed(() => {
    if (selected_creation.value?.creation_id){
        return 'creation:' + selected_creation.value!.creation_id
    }
    return 'request:' + selected_creation.value!.request_id
})


const recreate = () => {
    Object.assign(blue, cloneDeep(selected_creation.value!.blueprint))
    state.tab = 'create'
    state.editor = null
}


</script>


<style lang='sass' scoped>

.explain
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center
    flex-grow: 1
    color: white
    text-align: center
    padding: 24px

</style>
