
<template lang='pug'>

iframe(v-if='iframe_src' :src='iframe_src')
div.explain(v-else :class='{pending: status === "pending"}')
    template(v-if='status === undefined')
    template(v-else-if='status === "pending"')
        h3(class='text-h4') Preparing some good news...
        AnimatedBook
        h1(class='my-10 text-h1') {{ time_since_request }}
        div(class='mb-10')
            | Most docs &nbsp;&nbsp;&nbsp;&nbsp; &lt; 1 minute&nbsp;&nbsp;&nbsp;&nbsp;<br>
            | Large docs  &nbsp;&nbsp;&nbsp;&nbsp; &lt; {{ MAX_MINUTES }} minutes
    template(v-else-if='status === "failed"')
        h3(class='mb-6') An error occurred
        div
            v-btn(:href='contact_url' target='_blank' color='secondary') Contact Us
        p(class='mt-12 mb-3') Please include this code in your email:
        p
            strong {{ debug }}
    template(v-else-if='status === "expired"')
        h3(class='mb-6') PDF has expired
        div
            v-btn(@click='recreate' color='secondary') Recreate

</template>


<script lang='ts' setup>

import {computed, ref, watch, onUnmounted} from 'vue'

import {blue, selected_creation, state} from '@/services/state'
import {clean_blueprint} from '@/services/blueprints'
import {gen_creation_url} from '@/services/backend'
import {MAX_MINUTES} from '@/services/create'
import AnimatedBook from '../reuseable/AnimatedBook.vue'


const time_since_request = ref('')
let timer_interval:number|null = null


const status = computed(() => {
    return selected_creation.value?.status
})


const iframe_src = computed(() => {
    if (selected_creation.value?.status === 'available'){
        return gen_creation_url(selected_creation.value.creation_id!, 'pdf')
    }
    return null
})


const contact_url = computed(() => {
    return 'https://gracious.tech/contact?desc=' + encodeURIComponent(debug.value)
})


const debug = computed(() => {
    let info = 'request:' + selected_creation.value!.request_id
    if (selected_creation.value?.creation_id){
        info += ' creation:' + selected_creation.value!.creation_id
    }
    return info
})


const recreate = () => {
    Object.assign(blue, clean_blueprint(selected_creation.value!.blueprint))
    state.tab = 'create'
    state.editor = null
}


watch(selected_creation, creation => {
    // Constantly update time since request for selected creation

    // Clear any previous interval
    if (timer_interval){
        clearInterval(timer_interval)
    }

    // Only needed if request is pending
    if (creation?.status === 'pending'){
        timer_interval = setInterval(() => {

            // If request is no longer pending then can stop updating
            if (creation.status !== 'pending'){
                clearInterval(timer_interval!)
                return
            }

            // Get difference in seconds
            const diff = (new Date().getTime() - creation.created.getTime()) / 1000
            const minutes = Math.floor(diff / 60).toString()
            const seconds = Math.floor(diff % 60).toString().padStart(2, '0')
            time_since_request.value = `${minutes}:${seconds}`

        }, 100)  // Update every 1/10th of second for smooth updates
    }
}, {immediate: true})


onUnmounted(() => {
    // Clear any running interval
    if (timer_interval){
        clearInterval(timer_interval)
    }
})

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

    &.pending
        background: url(@/assets/donate_arrow.svg?url), linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)
        background-size: 540px, 400% 400%
        background-repeat: no-repeat
        animation: pending 20s ease infinite


@keyframes pending
    0%
        background-position: left top, 0% 0%
    25%
        background-position: left top, 100% 50%
    50%
        background-position: left top, 0% 100%
    75%
        background-position: left top, 100% 100%
    100%
        background-position: left top, 0% 0%

</style>
