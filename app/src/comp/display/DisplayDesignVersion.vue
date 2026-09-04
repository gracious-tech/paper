
<template lang='pug'>

div.version
    //- Toolbar for a rendered version — mirrors the preview toolbar shown while editing.
    //- Only meaningful once there's a PDF to show (hidden while pending/failed/expired)
    div.toolbar(v-if='iframe_src')
        //- Left: switch the frame between the interior pages and the wraparound cover — only
        //- shown when this version actually has a cover
        //- Cover toggle / download stay visible but disabled when the cover render failed
        //- (cover_failed) — the interior compiled and is unaffected
        v-btn-toggle.mode(v-if='cover_src || cover_failed' v-model='view_mode'
                color='primary-light' divided mandatory)
            v-btn(value='interior' size='small') {{ $t("display.version.show_interior") }}
            v-btn(value='cover' size='small' :disabled='!cover_src')
                | {{ $t("display.version.show_cover") }}
        //- Middle: download the print-ready PDF(s) — same weight/colour as the preview
        //- toolbar's Create button
        div.downloads
            v-btn(@click='download_interior' variant='elevated' color='secondary-darken-1')
                template(#prepend)
                    app-icon(name='download')
                | {{ $t("display.version.download_interior") }}
            v-btn(v-if='cover_src || cover_failed' @click='download_cover' variant='elevated'
                    color='secondary-darken-1' :disabled='!cover_src')
                template(#prepend)
                    app-icon(name='download')
                | {{ $t("display.version.download_cover") }}
        //- Right: printing guidance, tailored to the version's printing service
        v-btn.how_to_print(v-if='selected_version' variant='elevated' color=''
                @click='state.how_to_print = selected_version.blueprint')
            template(#prepend)
                app-icon(name='print')
            | {{ $t("display.version.how_to_print") }}

    //- Thin advisory strip under the toolbar — one message at a time: viewing a superseded
    //- version, the latest version having unrendered design changes, or booklet page ordering.
    //- Design decision: this strip only ever describes what the on-screen preview is showing
    //- (an old render, a flat-and-out-of-order booklet), so it deliberately lives with the
    //- preview and shares its fate — AppRoot hides the whole preview pane below 900px. Anything
    //- a mobile user must act on regardless of the preview (e.g. the binding page-limit warning)
    //- belongs in the always-visible version summary in DesignVersionsList.vue instead.
    div.notice(v-if='iframe_src && version_warning' :class='version_warning.tone')
        app-icon(:name='version_warning.tone === "info" ? "info" : "warning"')
        span {{ version_warning.text }}

    div.doc(v-if='iframe_src')
        iframe(:src='current_src')
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
            div
                v-btn(@click='regen' color='secondary') {{$t("common.try_again")}}
            div(class='my-6') or
            div
                v-btn(:href='contact_url' target='_blank' variant='tonal' color='secondary') {{$t("display.version.contact")}}
            p(class='mt-4 mb-3') {{$t("display.version.include_code")}}
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

import {selected_version, get_pdf_url, get_cover_pdf_url, download_version_pdf, regenerate_version,
    retry_version, version_expired, version_stuck, latest_version, design_needs_editor,
    version_debug_ref, version_contact_url, cover_failed as version_cover_failed}
    from '@/services/versions'
import {designs, current_design_id} from '@/services/designs'
import {state} from '@/services/state'
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


// Whether the selected version's interior is available but its cover render failed
const cover_failed = computed(() => {
    return selected_version.value ? version_cover_failed(selected_version.value) : false
})


// Single advisory line for the strip under the toolbar, with its tone: being out of date
// (viewing a superseded version, or the latest one with unrendered design edits) is a "warning"
// and takes priority over the evergreen booklet page-order "notice". Only one shows at a time
const version_warning = computed(() => {
    const version = selected_version.value
    if (!version){
        return null
    }
    // Superseded — a newer version of this design exists
    if (latest_version.value && version.id !== latest_version.value.id){
        return {text: t('display.version.not_latest'), tone: 'warning'}
    }
    // Latest version, but the design has changed since it was created. `design_needs_editor`
    // can't distinguish "no local design" from "has changes", so only trust it when the design
    // is one the user can actually edit
    const is_editor = designs.some(item => item.id === current_design_id.value)
    if (is_editor && design_needs_editor.value){
        return {text: t('display.version.has_unapplied'), tone: 'warning'}
    }
    // Booklet pages are imposed for folding, so they read out of sequence flat — informational,
    // not a problem to fix
    if (version.blueprint.booklet){
        return {text: t('display.version.booklet_order'), tone: 'info'}
    }
    return null
})


// Whether the toolbar's frame is showing the interior pages or the wraparound cover
const view_mode = ref<'interior'|'cover'>('interior')

// Download URLs of the stored interior + cover PDFs (resolved async whenever the selected
// version changes); cover_src stays null for versions without a cover
const iframe_src = ref(null as string|null)
const cover_src = ref(null as string|null)
let resolve_count = 0
watch([selected_version, status], async () => {
    const version = selected_version.value
    const this_resolve = ++resolve_count
    // Reset to the interior view whenever the selected version changes
    view_mode.value = 'interior'
    const [pdf_url, cover_url] = version
        ? await Promise.all([get_pdf_url(version), get_cover_pdf_url(version)])
        : [null, null]
    // Ignore stale resolutions if the selection changed while awaiting
    if (this_resolve === resolve_count){
        iframe_src.value = pdf_url
        cover_src.value = cover_url
    }
}, {immediate: true})


// Which PDF the frame shows — the cover only while toggled to it and one actually exists
const current_src = computed(() => {
    const src = view_mode.value === 'cover' && cover_src.value ? cover_src.value : iframe_src.value
    return src ?? undefined
})


// Save the interior PDF to disk (see download_version_pdf)
const download_interior = () => {
    if (selected_version.value){
        void download_version_pdf(selected_version.value, 'interior')
    }
}


// Save the separate cover PDF to disk
const download_cover = () => {
    if (selected_version.value){
        void download_version_pdf(selected_version.value, 'cover')
    }
}


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


// Prefilled support-contact link + the bare identifying string shown for the user to quote
const contact_url = computed(() => version_contact_url(selected_version.value ?? null))
const debug = computed(() => version_debug_ref(selected_version.value ?? null))


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

// Fills the panel (.display > * in AppRoot gives this container 100% width/height); stacks the
// toolbar above the PDF frame / status area
.version
    display: flex
    flex-direction: column
    width: 100%
    height: 100%

// Mirrors the preview toolbar in DisplayPreview.vue (dark strip along the top)
.toolbar
    flex-shrink: 0
    display: flex
    align-items: center
    gap: 12px
    padding: 8px
    background-color: rgba(0, 0, 0, 0.2)

    // Centre the download buttons in the toolbar whether or not the mode toggle is present on
    // the left; "How to print" then trails on the far right
    .downloads
        display: flex
        align-items: center
        gap: 8px
        margin-left: auto
        margin-right: auto

    .how_to_print
        flex-shrink: 0

    // Active toggle label in brand primary over its primary-light fill (on the dark toolbar)
    :deep(.v-btn-toggle .v-btn--active)
        color: rgb(var(--v-theme-primary))

    // A v-btn-group ignores its children's size and has no density tier below 40px, so
    // set a compact height directly to sit with the size='small' child buttons.
    .mode
        height: 32px

// Thin advisory strip between the toolbar and the PDF frame
.notice
    flex-shrink: 0
    display: flex
    align-items: center
    justify-content: center
    gap: 8px
    padding: 4px 12px
    font-size: 0.8125rem
    line-height: 1.3

    .icon
        flex-shrink: 0
        height: 18px
        width: 18px

    // Something the user should act on (out-of-date version) — full warning colour
    &.warning
        color: rgb(var(--v-theme-on-warning))
        background-color: rgb(var(--v-theme-warning))

    // Just informational (booklet page order) — light blue, distinct from the orange warnings
    &.info
        color: #123a5c
        background-color: #bcd8f2

// Holds just the PDF frame, filling the container's leftover height below the toolbar/notice
.doc
    display: flex
    flex-direction: column
    flex-grow: 1
    min-height: 0

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
