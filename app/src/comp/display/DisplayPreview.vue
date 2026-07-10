
<template lang='pug'>

div.preview
    div.toolbar
        v-btn-toggle(:model-value='mode' @update:model-value='set_mode'
            density='compact' variant='elevated' color='secondary' divided mandatory)
            v-btn(v-if='blue.booklet' value='reading' size='small') {{ $t("Reading") }}
            v-btn(value='print' size='small') {{ $t("Print") }}
        //- Which part of a large document to preview — only shown when the document exceeded
        //- the preview size limit and had to be truncated
        v-btn-toggle(v-if='truncated' :model-value='section' @update:model-value='set_section'
            density='compact' variant='elevated' color='secondary' divided mandatory)
            v-btn(value='start' size='small') {{ $t("Start") }}
            v-btn(value='middle' size='small') {{ $t("Middle") }}
            v-btn(value='end' size='small') {{ $t("End") }}

    div.frame(v-if='pdf_url')
        iframe(:src='pdf_url')
        //- Semi-transparent readout of the in-progress recompile, layered over the still-visible
        //- (and still-scrollable, via pointer-events:none) previous PDF
        transition(name='fade')
            div.overlay(v-if='progress_message || overlay_error')
                div.overlay_box(:class='{error: overlay_error}')
                    p(v-if='overlay_error' class='overlay_title')
                        strong {{ overlay_error_title }}
                    p {{ overlay_error || progress_message }}
    div.status(v-else-if='error_msg')
        h3(class='mb-4') {{ $t("Couldn't generate preview") }}
        p(class='status-detail') {{ error_msg }}
    div.status(v-else)
        p {{ progress_message || $t("Generating preview") + "…" }}

</template>


<script lang='ts' setup>

import {ref, computed, watch, onUnmounted} from 'vue'
import {debounce} from 'lodash-es'
import {useI18n} from 'vue-i18n'

import {blue} from '@/services/state'
import {content, bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {get_custom_font_styles} from '@/services/custom_fonts'
import {truncate_for_preview} from 'paper-bible-typst'

import type {ProgressEvent, PreviewSection} from 'paper-bible-typst'


const {t} = useI18n()


// Object URL of the current compiled PDF, and any compile error message
const pdf_url = ref<string|null>(null)
const error_msg = ref<string|null>(null)

// Text for the currently active progress stage, or null between compiles (and for stages the
// user doesn't need to see — see stage_text() below)
const progress_message = ref<string|null>(null)

// Set instead of progress_message when a recompile fails while an old preview is still showing
// underneath — the overlay stays up (rather than vanishing back to the stale PDF unexplained)
// and turns red to surface the failure
const overlay_error = ref<string|null>(null)

// Title shown above overlay_error — kept out of the template since the pug-to-TS bridge
// mishandles the unbalanced parenthesis in the smiley within an inline mustache expression
const overlay_error_title = computed(() => t("Something went wrong :("))

// Which layout to render: 'reading' = facing-page book spreads (default),
// 'print' = the actual final PDF (folded booklet order or sequential pages)
const mode = ref<'reading'|'print'>('reading')

// The reading spread view only makes sense for booklets; non-booklets print sequentially,
// so force 'print' whenever booklet is off (the Reading toggle is also hidden then)
watch(() => blue.booklet, booklet => {
    if (!booklet){
        mode.value = 'print'
    }
}, {immediate: true})

// Switch the preview layout and immediately recompile (no debounce for an explicit click)
function set_mode(value:'reading'|'print'){
    mode.value = value
    compile()
}

// Which portion of an over-long document to preview. Documents past the preview size limit
// are truncated to a fast-compiling window positioned by this (see truncate_for_preview).
const section = ref<PreviewSection>('start')

// Whether the last compile had to truncate the document (shows the Start|Middle|End toggle)
const truncated = ref(false)

// Switch the previewed section and immediately recompile (no debounce for an explicit click)
function set_section(value:PreviewSection){
    section.value = value
    void compile()
}

// Incrementing id so out-of-order async compiles can be discarded
let latest_run = 0


// Map a coarse progress event to the (translated) text shown in the overlay. Only a handful of
// stages are meaningful to a user watching a preview regenerate; the rest (e.g. 'arrange', the
// booklet/spread imposition step) return null so the overlay just keeps showing whatever it
// last showed rather than flashing an unrelated message
function stage_text(event:ProgressEvent):string|null {
    if (event.stage === 'start'){
        return t("Getting started") + "…"
    }
    if (event.stage === 'fetch'){
        return `${t("Downloading")} ${event.label} (${event.i}/${event.total})`
    }
    if (event.stage === 'compile'){
        return `${t("Writing")} ${event.label} (${event.i}/${event.total})`
    }
    if (event.stage === 'finalize'){
        return t("Final touches") + "…"
    }
    return null
}


// Compile the current blueprint to a PDF and display it
async function compile(){

    // Wait until the WASM compiler is ready (watcher retriggers when it becomes available)
    const generator = typst_generator.value
    if (!generator){
        return
    }

    const run = ++latest_run
    error_msg.value = null
    overlay_error.value = null

    // Forwarded to both the content-fetching and PDF-compiling stages, so the overlay reflects
    // whichever one is currently running
    const on_progress = (event:ProgressEvent) => {
        if (run !== latest_run){
            return
        }
        const text = stage_text(event)
        if (text !== null){
            progress_message.value = text
        }
    }

    try {
        // 'reading' lays out the pages as facing-page book spreads (as if the book were opened);
        // 'print' produces the final PDF layout (booklet fold order, or sequential if not a
        // booklet) with print-only blank padding relaxed for the screen (preview flag below)
        const request = await bible_content.resolve(blue, get_custom_font_styles(), on_progress)

        // Large documents are cut down to a fast-compiling ~50 page window (positioned by the
        // Start|Middle|End toggle), with a notice page wherever content was cut short
        const truncation = truncate_for_preview(request, section.value, {
            start_title: t("Start of preview"),
            end_title: t("End of preview"),
            detail: t("Create document to see the rest"),
        })

        const bytes = mode.value === 'print'
            ? await generator.compile_pdf(truncation.request, on_progress, true)
            : await generator.compile_pdf_preview(truncation.request, on_progress)

        // Ignore if a newer compile has started since
        if (run !== latest_run){
            return
        }
        truncated.value = truncation.truncated

        // Swap in the new PDF and revoke the previous object URL
        const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}))
        if (pdf_url.value){
            URL.revokeObjectURL(pdf_url.value)
        }
        pdf_url.value = url

    } catch (error){
        if (run !== latest_run){
            return
        }
        const message = error instanceof Error ? error.message : String(error)
        console.error(error)

        // An old preview is still showing underneath — keep the overlay up and turn it red to
        // explain the failure, rather than silently reverting to the (now stale) PDF
        if (pdf_url.value){
            overlay_error.value = message
        } else {
            error_msg.value = message
        }
    } finally {
        if (run === latest_run){
            progress_message.value = null
        }
    }
}


// Debounce so rapid option changes don't trigger a compile per keystroke
const compile_debounced = debounce(compile, 500)


// Recompile whenever the blueprint, fetched Typst content, or compiler availability changes
watch(
    [() => blue, () => content.loaded, () => typst_generator.value],
    () => compile_debounced(),
    {deep: true, immediate: true},
)

// Build a signature of every "discrete choice" field in the blueprint: checkboxes, selects,
// radios, toggle-buttons and the like. These change in one atomic step (a click), never build up
// character by character like a text field or drag like a slider, so there's no rapid-fire flurry
// of updates to debounce -- recompiling instantly feels responsive rather than laggy. Text fields,
// sliders and colour pickers are deliberately left out here so they fall through to the debounced
// watcher below instead.
function discrete_signature():string {
    const item_sigs = blue.content.map(item => {
        if (item.type === 'title'){
            return `title:${item.pattern}:${item.alone}`
        } else if (item.type === 'passage'){
            return `passage:${item.title}:${item.new_page}`
        }
        return `custom:${item.position}:${item.new_page}`
    })
    return JSON.stringify([
        blue.font_text, blue.font_text2, blue.font_headings, blue.font_titles,
        blue.service_id, blue.size_id, blue.binding_type, blue.ink_type, blue.paper_type,
        blue.custom_unit, blue.booklet, blue.booklet_portrait,
        blue.bibles_layout, blue.half_blank, blue.justify, blue.columns,
        blue.show_headings, blue.show_headings_bold, blue.show_headings_italic,
        blue.show_chapters, blue.show_chapters_style, blue.show_verses,
        blue.show_pages, blue.show_footnotes, blue.show_wj, blue.show_wj_bold,
        blue.show_wj_italic, blue.show_lines, blue.notes, blue.crossref,
        blue.margin_unit, blue.public_domain, blue.app_link,
        item_sigs,
    ])
}

// Recompile right away whenever a discrete field changes. Registered after the watcher above so
// it runs later in the same flush, cancelling whatever debounce that one just queued.
watch(discrete_signature, () => {
    compile_debounced.cancel()
    void compile()
})


// Clean up pending work and the last object URL
onUnmounted(() => {
    compile_debounced.cancel()
    if (pdf_url.value){
        URL.revokeObjectURL(pdf_url.value)
    }
})

</script>


<style lang='sass' scoped>

.preview
    display: flex
    flex-direction: column
    width: 100%
    height: 100%

.toolbar
    flex-shrink: 0
    display: flex
    justify-content: center
    gap: 12px
    padding: 8px
    background-color: rgba(0, 0, 0, 0.2)

.frame
    position: relative
    flex-grow: 1
    width: 100%
    overflow: hidden

iframe
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    border: none

.overlay
    position: absolute
    inset: 0
    display: flex
    align-items: center
    justify-content: center
    padding: 24px
    // Old preview stays scrollable/interactive underneath — this is a readout, not a blocker
    pointer-events: none

.overlay_box
    padding: 12px 20px
    border-radius: 12px
    color: white
    text-align: center
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4)
    // Same animated gradient as the "pending creation" state in DisplayCreation.vue, scoped to
    // just this small readout rather than the whole panel
    background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)
    background-size: 400% 400%
    animation: pending 20s ease infinite

    p
        margin: 0
        max-width: 320px
        font-size: 15px

    &.error
        background: #b3261e
        animation: none

        p
            font-family: monospace
            font-size: 12px
            white-space: pre-wrap
            max-width: 420px

@keyframes pending
    0%
        background-position: 0% 0%
    25%
        background-position: 100% 50%
    50%
        background-position: 0% 100%
    75%
        background-position: 100% 100%
    100%
        background-position: 0% 0%

.fade-enter-active, .fade-leave-active
    transition: opacity 0.2s ease

.fade-enter-from, .fade-leave-to
    opacity: 0

.status
    flex-grow: 1
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center
    height: 100%
    color: white
    text-align: center
    padding: 24px

    .status-detail
        max-width: 600px
        font-family: monospace
        font-size: 12px
        white-space: pre-wrap
        opacity: 0.8

</style>
