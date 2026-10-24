
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

        div.pages(v-if='preview')
            img.page(v-for='(url, i) of page_urls' :key='url' :src='url' alt=''
                :loading='i < 2 ? "eager" : "lazy"' decoding='async')
            //- More of the document follows the pages shown, which only the built PDF has
            div.end(v-if='preview.truncated')
                strong {{ $t("display.preview.end_of_preview") }}
                div {{ $t("display.preview.build_for_rest") }}
        div.status(v-else-if='slow')
            p {{ $t("dialog.phone_preview.too_slow") }}
        div.status(v-else-if='failed')
            h3(class='mb-4') {{ $t("display.preview.failed") }}
            v-btn(@click='compile' variant='tonal' color='white') {{ $t("common.try_again") }}
        div.status(v-else)
            v-progress-circular(indeterminate color='white' class='mb-6')
            p {{ progress_message || $t("display.preview.generating_preview") + "…" }}

</template>


<script lang='ts' setup>

import {ref, computed, watch, onUnmounted} from 'vue'
import {useRouter} from 'vue-router'

import {useI18n} from '@/services/i18n'
import {state} from '@/services/state'
import {report_error} from '@/services/errors'
import {stage_text} from '@/services/compile_progress'
import {compile_phone_preview, SlowPreviewError} from '@/services/phone_preview'
import {AbandonedCompileError} from '@/services/typst'
import {build_design, build_starting} from '@/services/build'

import type {PhonePreview} from '@/services/phone_preview'
import type {CompileProgress} from '@/services/compile_progress'


const {t} = useI18n()
const router = useRouter()


// The preview being shown, and its pages as object URLs for the <img>s
const preview = ref<PhonePreview|null>(null)
const page_urls = ref<string[]>([])

// Whether the last attempt failed, and whether that was for taking too long (after which this
// device builds on the server, so there's no point offering another go)
const failed = ref(false)
const slow = ref(false)

// The current compile stage's readout, null between stages that have nothing to say
const progress_message = ref<string|null>(null)

// Incrementing id, so an attempt overtaken by a newer one (the dialog closed and reopened while
// it ran) never shows its result
let latest_run = 0


// Building needs nothing from the preview, but a failure of its own is worth a look first, so
// only while one is still compiling is it held back (a slow preview means the server builds)
const can_build = computed(() => !!preview.value || failed.value || slow.value)


function revoke_pages():void{
    // Release the object URLs of the pages shown
    for (const url of page_urls.value){
        URL.revokeObjectURL(url)
    }
    page_urls.value = []
}


async function compile():Promise<void>{
    // Compile the open design's preview and show it
    const run = ++latest_run
    preview.value = null
    failed.value = false
    slow.value = false
    progress_message.value = null
    revoke_pages()
    const on_progress = (event:CompileProgress) => {
        const text = stage_text(event, t)
        if (run === latest_run && text !== null){
            progress_message.value = text
        }
    }
    try {
        const result = await compile_phone_preview(on_progress)
        if (run !== latest_run){
            return
        }
        page_urls.value = result.pages.map(markup =>
            URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml'})))
        preview.value = result
    } catch (error){
        if (run !== latest_run){
            return
        }
        if (error instanceof SlowPreviewError){
            slow.value = true
        } else if (!(error instanceof AbandonedCompileError)){
            report_error('silent', error, {context: {stage: 'phone_preview'}})
            failed.value = true
        }
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
        revoke_pages()
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


onUnmounted(revoke_pages)

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

.pages
    flex-grow: 1
    overflow-y: auto
    display: flex
    flex-direction: column
    align-items: center
    gap: 12px
    padding: 12px

    // Each page as wide as the screen allows, keeping its own proportions
    .page
        width: 100%
        max-width: 600px
        height: auto
        background-color: white
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)

    .end
        max-width: 600px
        padding: 12px 16px
        border-radius: 8px
        text-align: center
        color: rgb(26, 26, 26)
        background-color: rgb(255, 224, 178)

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
