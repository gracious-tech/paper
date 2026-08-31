
<template lang='pug'>

div.doc(v-if='iframe_src')
    //- Firm warning when the produced document's actual page count broke its chosen binding —
    //- unlike the soft estimate-based warning while designing, this one is definite
    v-alert(v-if='binding_warning' type='warning' variant='flat' density='compact' rounded='0'
        :text='binding_warning')
    iframe(:src='iframe_src')
div.explain(v-else :class='{pending: status === "pending" && !stuck}')
    template(v-if='status === undefined')
    template(v-else-if='status === "pending" && stuck')
        h3(class='mb-6') {{$t("display.version.taking_long")}}
        p(class='mb-6') {{$t("display.version.interrupted")}}
        div(class='mb-6')
            v-btn(@click='retry' color='secondary' :loading='retrying') {{$t("common.try_again")}}
        div
            v-btn(:href='contact_url' target='_blank' variant='text') {{$t("display.version.contact")}}
    template(v-else-if='status === "pending"')
        h3(class='text-headline-large') {{$t("display.version.preparing") + '...'}}
        AnimatedBook
        h1(class='my-10 text-display-large') {{ time_since_request }}
        div(class='mb-10')
            | {{$t("display.version.typical_time")}}
    template(v-else-if='status === "failed"')
        h3(class='mb-6') {{$t("display.version.error")}}
        div(class='mb-6')
            v-btn(@click='regen' color='secondary') {{$t("common.try_again")}}
        div
            v-btn(:href='contact_url' target='_blank' variant='text') {{$t("display.version.contact")}}
        p(class='mt-12 mb-3') {{$t("display.version.include_code")}}
        p
            strong {{ debug }}
    template(v-else-if='expired')
        h3(class='mb-6') {{$t("display.version.pdf_expired")}}
        p(class='mb-6') {{$t("display.version.settings_saved")}}
        div
            v-btn(@click='regen' color='secondary') {{$t("common.regenerate")}}

</template>


<script lang='ts' setup>

import {computed, ref, watch, onUnmounted} from 'vue'
import {useI18n} from '@/services/i18n'

import {selected_version, get_pdf_url, regenerate_version, retry_version, version_expired,
    version_stuck} from '@/services/versions'
import {binding_page_issue} from '@/services/blueprints'
import {report_error} from '@/services/errors'
import AnimatedBook from '../reuseable/AnimatedBook.vue'


const {t} = useI18n()


const time_since_request = ref('')
let timer_interval:ReturnType<typeof setInterval>|null = null


// Ticking wall clock, advanced by the pending timer below so `stuck` re-evaluates as time passes
const now = ref(Date.now())


const status = computed(() => {
    return selected_version.value?.status
})


// Whether a pending version has been sitting long enough that its compile was almost certainly
// abandoned (tab reload/close/crash, killed server instance) — offer a retry, not an endless wait
const stuck = computed(() => {
    void now.value
    return selected_version.value ? version_stuck(selected_version.value) : false
})


// Whether the selected version's PDF has passed its Storage lifetime
const expired = computed(() => {
    return selected_version.value ? version_expired(selected_version.value) : false
})


// Warning text when the document's actual page count isn't supported by the binding it was
// designed for — the design needs its binding changed and a new version created. Firmer when
// the design has a cover, since a binding change also changes the cover's spine/dimensions.
// States whether it's too short or too long and the limit, since a bare "doesn't support this
// page count" leaves the user guessing which direction to fix
const binding_warning = computed(() => {
    const version = selected_version.value
    if (!version || version.status !== 'available' || version.pages === null){
        return null
    }
    const issue = binding_page_issue(version.blueprint, version.pages)
    if (!issue){
        return null
    }
    const key = issue.fewer
        ? 'display.version.binding_min_warning'
        : 'display.version.binding_max_warning'
    return t(key, {name: issue.name, limit: issue.limit, final: version.pages})
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


// Whether a retry of a stuck pending version is in flight
const retrying = ref(false)


// Re-drive a stuck pending version through the compile pipeline (see version_stuck / retry_version)
const retry = async () => {
    if (!selected_version.value){
        return
    }
    retrying.value = true
    try {
        await retry_version(selected_version.value)
    } catch (error){
        report_error('banner', error)
    } finally {
        retrying.value = false
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

            // Advance the shared clock so `stuck` re-evaluates
            now.value = Date.now()

            // Count from the current compile attempt (a regen/retry re-stamps compile_started),
            // falling back to creation for older versions that predate the field
            const started = version.compile_started ?? version.created
            const diff = (new Date().getTime() - started.getTime()) / 1000
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

// Column so a binding warning can sit above the PDF without breaking the parent's full-size
// sizing (.display > * in AppRoot gives this container 100% width/height)
.doc
    display: flex
    flex-direction: column

    // Vuetify's v-alert defaults to `flex: 1 1`, which fights the iframe for the container's
    // leftover height (both would grow equally) — pin it to its content size instead
    .v-alert
        flex-grow: 0
        flex-basis: auto

    iframe
        flex-grow: 1
        width: 100%
        border: none

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
