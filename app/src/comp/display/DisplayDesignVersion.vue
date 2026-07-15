
<template lang='pug'>

iframe(v-if='iframe_src' :src='iframe_src')
div.explain(v-else :class='{pending: status === "pending"}')
    template(v-if='status === undefined')
    template(v-else-if='status === "pending"')
        h3(class='text-h4') {{$t("Preparing some good news") + '...'}}
        AnimatedBook
        h1(class='my-10 text-h1') {{ time_since_request }}
        div(class='mb-10')
            | {{$t("Most docs")}} &nbsp;&nbsp;&nbsp;&nbsp; &lt; 1 {{$t("minute")}}&nbsp;&nbsp;&nbsp;&nbsp;<br>
    template(v-else-if='status === "failed"')
        h3(class='mb-6') {{$t("An error occurred")}}
        div(class='mb-6')
            v-btn(@click='regen' color='secondary') {{$t("Try again")}}
        div
            v-btn(:href='contact_url' target='_blank' variant='text') {{$t("Contact Us")}}
        p(class='mt-12 mb-3') {{$t("Please include this code in your email:")}}
        p
            strong {{ debug }}
    template(v-else-if='expired')
        h3(class='mb-6') {{$t("This document's PDF has expired")}}
        p(class='mb-6') {{$t("Its settings are still saved, so it can be generated again.")}}
        div
            v-btn(@click='regen' color='secondary') {{$t("Regenerate")}}

</template>


<script lang='ts' setup>

import {computed, ref, watch, onUnmounted} from 'vue'

import {selected_version, get_pdf_url, regenerate_version, version_expired,
    } from '@/services/versions'
import AnimatedBook from '../reuseable/AnimatedBook.vue'


const time_since_request = ref('')
let timer_interval:number|null = null


const status = computed(() => {
    return selected_version.value?.status
})


// Whether the selected version's PDF has passed its Storage lifetime
const expired = computed(() => {
    return selected_version.value ? version_expired(selected_version.value) : false
})


// Download URL of the stored PDF (resolved async whenever the selected version changes)
const iframe_src = ref(null as string|null)
let resolve_count = 0
watch([selected_version, status], async () => {
    const version = selected_version.value
    const this_resolve = ++resolve_count
    const url = version ? await get_pdf_url(version) : null
    // Ignore stale resolutions if the selection changed while awaiting
    if (this_resolve === resolve_count){
        iframe_src.value = url
    }
}, {immediate: true})


// Recompile the failed/expired PDF from the version's frozen blueprint
const regen = () => {
    if (selected_version.value){
        void regenerate_version(selected_version.value)
    }
}


const contact_url = computed(() => {
    return 'https://gracious.tech/contact?desc=' + encodeURIComponent(debug.value)
})


const debug = computed(() => {
    // Include the saved error report's id when the failure was recorded (client or server side)
    const version = selected_version.value
    const error_part = version?.error_id ? ` error:${version.error_id}` : ''
    return 'version:' + (version?.id ?? '') + error_part
})


watch(selected_version, version => {
    // Constantly update time since request for selected version

    // Clear any previous interval
    if (timer_interval){
        clearInterval(timer_interval)
    }

    // Only needed if request is pending
    if (version?.status === 'pending'){
        timer_interval = setInterval(() => {

            // If request is no longer pending then can stop updating
            if (version.status !== 'pending'){
                clearInterval(timer_interval!)
                return
            }

            // Get difference in seconds
            const diff = (new Date().getTime() - version.created.getTime()) / 1000
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
