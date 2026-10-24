
<template lang='pug'>

//- Full screen, over the app bar too: a phone has no room to spare around the pages
v-dialog(v-model='state.phone_preview' fullscreen transition='dialog-bottom-transition'
        :scrim='false')
    v-card.preview(color='surface')
        div.bar
            v-btn(@click='close' variant='text' color='white')
                template(#prepend)
                    app-icon(name='arrow_back')
                | {{ $t("dialog.phone_preview.keep_editing") }}
            v-spacer
            v-btn(@click='build' variant='elevated' color='secondary-darken-1'
                    :disabled='!can_build' :loading='build_starting')
                | {{ $t("view.design.build_it") }}

        div.scroll(v-if='preview')
            DisplayPreviewPages(:preview='preview' layout='column')
        div.status(v-else-if='failed')
            h3(class='mb-4') {{ $t("display.preview.failed") }}
            v-btn(@click='compile' variant='tonal' color='white') {{ $t("common.try_again") }}
        div.status(v-else)
            v-progress-circular(indeterminate color='white' class='mb-6')
            //- Said once this device turned out too slow, while the server makes it instead
            p(v-if='slow') {{ $t("dialog.phone_preview.too_slow") }}
            p(v-else) {{ progress_message || $t("display.preview.generating_preview") + "…" }}

</template>


<script lang='ts' setup>

import {ref, computed, watch} from 'vue'
import {useRouter} from 'vue-router'

import DisplayPreviewPages from '@/comp/display/DisplayPreviewPages.vue'

import {useI18n} from '@/services/i18n'
import {state} from '@/services/state'
import {report_error} from '@/services/errors'
import {stage_text} from '@/services/compile_progress'
import {phone_preview} from '@/services/preview'
import {ServerPreviewError} from '@/services/server_preview'
import {build_design, build_starting} from '@/services/build'

import type {Preview} from '@/services/preview'
import type {CompileProgress} from '@/services/compile_progress'


const {t} = useI18n()
const router = useRouter()


// The preview being shown
const preview = ref<Preview|null>(null)

// Whether the last attempt failed, and whether this browser turned out too slow for it (after
// which the server makes it, and builds on this device from now on)
const failed = ref(false)
const slow = ref(false)

// The current compile stage's readout, null between stages that have nothing to say
const progress_message = ref<string|null>(null)

// Incrementing id, so an attempt overtaken by a newer one (the dialog closed and reopened while
// it ran) never shows its result
let latest_run = 0


// Building needs nothing from the preview, but a failure of its own is worth a look first, so
// only while one is still compiling is it held back (unless this browser was too slow for it,
// since then the server builds too)
const can_build = computed(() => !!preview.value || failed.value || slow.value)


async function compile():Promise<void>{
    // Compile the open design's preview and show it
    const run = ++latest_run
    preview.value = null
    failed.value = false
    slow.value = false
    progress_message.value = null
    const on_progress = (event:CompileProgress) => {
        const text = stage_text(event, t)
        if (run === latest_run && text !== null){
            progress_message.value = text
        }
    }
    const on_slow = () => {
        if (run === latest_run){
            slow.value = true
        }
    }
    try {
        const result = await phone_preview(on_progress, on_slow)
        if (run !== latest_run){
            return
        }
        preview.value = result
    } catch (error){
        if (run !== latest_run){
            return
        }
        // A preview the server failed at was already reported there
        if (!(error instanceof ServerPreviewError && error.error_id)){
            report_error('silent', error, {context: {stage: 'phone_preview_server'}})
        }
        failed.value = true
        slow.value = false
    }
}


// A fresh preview each time it's opened, since the design may have changed since the last;
// closing drops the pages (and any attempt still running) to free the phone's memory
watch(() => state.phone_preview, open => {
    if (open){
        void compile()
    } else {
        latest_run += 1
        preview.value = null
    }
}, {immediate: true})


const close = () => {
    // Back to the editor
    state.phone_preview = false
}


const build = async () => {
    // Build what was previewed: the build is taken from the design as it is now, which is what
    // the preview showed, since the editor can't be reached while the preview is open
    state.phone_preview = false
    await build_design(router)
}

</script>


<style lang='sss' scoped>

// Dark around the pages, like the preview pane on desktop
.preview
    display: flex
    flex-direction: column
    height: 100%
    background-color: hsl(325, 10%, 25%) !important

.bar
    flex-shrink: 0
    display: flex
    align-items: center
    gap: 8px
    padding: 8px
    background-color: rgb(var(--v-theme-primary))

.scroll
    flex-grow: 1
    overflow-y: auto

.status
    flex-grow: 1
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center
    padding: 24px
    color: white
    text-align: center

</style>
