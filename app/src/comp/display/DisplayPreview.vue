
<template lang='pug'>

div.preview
    div.toolbar
        //- Which part of a large document to preview — only shown when the document was
        //- truncated and has more than one book/passage to window across
        v-btn-toggle.sections(v-if='truncated && section_options.length > 1'
            :model-value='effective_section' @update:model-value='set_section'
            color='primary-light' divided mandatory)
            v-btn(value='start' size='small') {{ $t("common.start") }}
            v-btn(v-if="section_options.includes('middle')" value='middle' size='small')
                | {{ $t("common.middle") }}
            v-btn(value='end' size='small') {{ $t("common.end") }}
        //- A device that previews on the server doesn't recompile as the design changes, so it
        //- asks for a fresh preview when wanted, and the button stands out once it's out of date
        v-btn(v-if='server_mode' @click='refresh' size='small'
                :variant='stale ? "elevated" : "tonal"'
                :color='stale ? "secondary-darken-1" : "primary-light"'
                :loading='!!progress_message')
            template(#prepend)
                app-icon(name='refresh')
            | {{ $t("display.preview.refresh") }}
        //- Hint + build button pushed to the right end of the toolbar via margin-left:auto on the
        //- hint (see style below); the mobile floating button lives in ViewDesignEditor.vue
        //- without the hint, since the preview isn't mounted at all on mobile (see AppRoot.vue)
        //- The arrow is kept out of the translated string so translators never handle it
        span(class='build_hint') {{ $t("display.preview.build_hint") }}
            span(class='build_arrow' aria-hidden='true') ➔
        BtnGenerate

    div.status(v-if='missing_warnings.length')
        h3(class='mb-4') {{ $t("display.preview.missing_books") }}
        p(v-for='warning of missing_warnings' class='status-detail') {{ warning }}
    div.frame(v-else-if='preview')
        div.scroll
            DisplayPreviewPages(:preview='preview' layout='spreads')
        //- Semi-transparent readout of the in-progress recompile, layered over the still-visible
        //- (and still-scrollable, via pointer-events:none) previous preview
        transition(name='fade')
            div.overlay(v-if='progress_message || overlay_failed')
                div.overlay_box(:class='{error: overlay_failed}')
                    p(v-if='overlay_failed' class='overlay_title')
                        strong {{ overlay_error_title }}
                    p {{ overlay_failed ? $t("display.preview.failed_build_hint") : progress_message }}
    //- The cause isn't shown: it's rarely meaningful to the user, and a preview failure says
    //- little about the build, which can fall back to the server
    div.status(v-else-if='failed')
        h3(class='mb-4') {{ $t("display.preview.failed") }}
        p {{ $t("display.preview.failed_build_hint") }}
    div.status(v-else)
        p {{ progress_message || $t("display.preview.generating_preview") + "…" }}

</template>


<script lang='ts' setup>

import {ref, shallowRef, computed, watch, onUnmounted} from 'vue'
import {debounce} from 'lodash-es'
import {useI18n} from '@/services/i18n'

import BtnGenerate from '@/comp/views/assets/BtnGenerate.vue'
import DisplayPreviewPages from '@/comp/display/DisplayPreviewPages.vue'
import {blue} from '@/services/state'
import {content} from '@/services/content'
import {collect_passage_books, missing_book_warnings} from '@/services/blueprints'
import {typst_generator} from '@/services/typst'
import {report_error} from '@/services/errors'
import {stage_text} from '@/services/compile_progress'
import {render_signature} from '@/services/page_estimate'
import {server_mode, compiles_on_server} from '@/services/compile_mode'
import {desktop_preview} from '@/services/preview'
import {ServerPreviewError} from '@/services/server_preview'

import type {PreviewSection} from 'paper-bible-typst'
import type {Preview} from '@/services/preview'
import type {CompileProgress} from '@/services/compile_progress'


const {t} = useI18n()


// The preview being shown, the render_signature() it was made from, and whether the last compile
// failed with no previous preview to keep showing
const preview = shallowRef<Preview|null>(null)
const shown_signature = ref<string|null>(null)
const failed = ref(false)

// Whether the design has changed since the preview shown was made — only ever the case for long
// on a device that previews on the server, where it waits for Refresh
const stale = computed(() => !!preview.value && shown_signature.value !== render_signature())

// Text for the currently active progress stage, or null between compiles (and for stages the
// user doesn't need to see — see stage_text() in compile_progress.ts)
const progress_message = ref<string|null>(null)

// Set instead of progress_message when a recompile fails while an old preview is still showing
// underneath — the overlay stays up (rather than vanishing back to the stale PDF unexplained)
// and turns red to surface the failure
const overlay_failed = ref(false)

// Title shown above the overlay's failure message — kept out of the template since the
// pug-to-TS bridge mishandles the unbalanced parenthesis in the smiley within an inline
// mustache expression
const overlay_error_title = computed(() => t("display.preview.error"))


// Report a failed preview and show it, over the old preview if there is one
function show_failure(error:unknown, stage:string):void{
    // Preview failures are transient while editing, so record without any support prompt
    // (the throttle in errors.ts stops this spamming reports per keystroke). One the server
    // failed at was already reported there
    if (!(error instanceof ServerPreviewError && error.error_id)){
        report_error('silent', error, {context: {stage}})
    }
    if (preview.value){
        overlay_failed.value = true
    } else {
        failed.value = true
    }
}

// Which portion of an over-long document to preview. Documents past the preview size limit
// are truncated to a fast-compiling window positioned by this (see truncate_for_preview).
const section = ref<PreviewSection>('start')

// Whether the last compile had to truncate the document (shows the Start|Middle|End toggle)
const truncated = ref(false)

// Number of book/passage sections in the document — the window buttons only make sense with
// more than one (1 = just "start", 2 = start/end, 3+ = all three, since with two books the
// middle is one or the other)
const passage_count = computed(() => blue.content.filter(item => item.type === 'passage').length)
const section_options = computed<PreviewSection[]>(() => {
    if (passage_count.value <= 1){
        return ['start']
    }
    if (passage_count.value === 2){
        return ['start', 'end']
    }
    return ['start', 'middle', 'end']
})

// The active section, clamped to what's currently offered (the document can shrink under the
// selection, e.g. a passage is deleted) — used for both the toggle highlight and the compile.
// A shrink recompiles via the normal blueprint watcher; the selection is remembered so it
// comes back if passages are re-added.
const effective_section = computed<PreviewSection>(() =>
    section_options.value.includes(section.value) ? section.value : 'start')

// Switch the previewed section and immediately recompile (no debounce for an explicit click)
function set_section(value:PreviewSection){
    section.value = value
    void compile()
}

// Whether a selected translation is missing a chosen book — shown instead of the preview, and
// blocks compiling since the document can't be generated as configured
const missing_warnings = computed(() => {
    return missing_book_warnings(collect_passage_books(blue.content), blue.bibles, t)
})

// Incrementing id so out-of-order async compiles can be discarded
let latest_run = 0


// Show a fresh preview of the current blueprint: made in this browser, or on the server for a
// device that compiles there or whose browser can't keep up (see desktop_preview)
async function compile(){

    // Wait until the WASM compiler is ready (watcher retriggers when it becomes available),
    // unless the server makes this device's previews
    if (!typst_generator.value && !compiles_on_server()){
        return
    }

    // Can't compile while a selected translation is missing a chosen book (shown as a warning
    // in place of the preview instead)
    if (missing_warnings.value.length){
        return
    }

    const run = ++latest_run
    const signature = render_signature()
    failed.value = false
    overlay_failed.value = false

    // Forwarded to every stage (the Bible's download, the compile, the cover, the server), so the
    // overlay reflects whichever one is currently running
    const on_progress = (event:CompileProgress) => {
        if (run !== latest_run){
            return
        }
        const text = stage_text(event, t)
        if (text !== null){
            progress_message.value = text
        }
    }

    try {
        const result = await desktop_preview(effective_section.value, on_progress,
            () => run === latest_run)
        if (run !== latest_run){
            return
        }
        truncated.value = result.truncated
        preview.value = result
        shown_signature.value = signature
    } catch (error){
        if (run !== latest_run){
            return
        }
        // If an old preview is still showing underneath, the overlay stays up and turns red to
        // explain the failure, rather than silently reverting to the (now stale) preview
        show_failure(error, 'preview')
    } finally {
        if (run === latest_run){
            progress_message.value = null
        }
    }
}


// Debounce so rapid option changes don't trigger a compile per keystroke
const compile_debounced = debounce(compile, 500)


// Recompile as the design changes, only where it compiles in this browser: on the server each
// preview costs us rather than the user's device, so there it's asked for by Refresh instead
function auto_compile():void{
    if (!compiles_on_server()){
        compile_debounced()
    }
}


// Ask for a fresh preview (a device that previews on the server, which doesn't recompile itself)
function refresh():void{
    compile_debounced.cancel()
    void compile()
}


// One compile as the pane opens, wherever it compiles
compile_debounced()

// Recompile whenever the blueprint changes. Keyed on render_signature() rather than
// deep-watching `blue` directly, so a change that doesn't alter what gets rendered (such as a
// rename) doesn't queue a compile
watch(render_signature, auto_compile)

// ...and whenever the fetched Typst content or compiler availability changes
watch(
    [() => content.loaded, () => typst_generator.value],
    auto_compile,
    {deep: true},
)

// Build a signature of every "discrete choice" field in the blueprint: checkboxes, selects,
// radios, toggle-buttons and the like. These change in one atomic step (a click), never build up
// character by character like a text field or drag like a slider, so there's no rapid-fire flurry
// of updates to debounce -- recompiling instantly feels responsive rather than laggy. Text fields,
// sliders and colour pickers are deliberately left out here so they fall through to the debounced
// watcher below instead.
function discrete_signature():string {
    // Title/passage items no longer have any discrete (non-text, non-color) per-item field —
    // title/title_subtitle/title_icon are all text/free-entry and fall through to the debounced
    // deep watcher below. 'custom' has its position; a picture story's slides each have a discrete
    // passage/text mode toggle and image-present toggle (the refs/text/image url are text-like and
    // fall through to the debounced watcher)
    const item_sigs = blue.content.flatMap(item => {
        if (item.type === 'custom'){
            return [`custom:${item.position}`]
        }
        if (item.type === 'picture_story'){
            return [`picture_story:${item.slides.map(s => `${s.mode}:${s.image ? 1 : 0}`).join(',')}`]
        }
        return []
    })
    return JSON.stringify([
        blue.font_text, blue.font_text2, blue.font_headings, blue.titlepage_font,
        blue.service_id, blue.size_id, blue.binding_type, blue.ink_type, blue.paper_type,
        blue.custom_unit, blue.booklet, blue.booklet_portrait,
        blue.bibles_layout, blue.bibles_align, blue.half_blank, blue.justify, blue.hyphenate,
        blue.columns,
        blue.show_headings, blue.show_headings_bold, blue.show_headings_italic,
        blue.show_chapters, blue.show_chapters_style, blue.show_verses,
        blue.running_pages, blue.running_headings, blue.running_position, blue.running_align,
        blue.show_footnotes, blue.show_wj, blue.show_wj_bold,
        blue.show_wj_italic, blue.show_lines, blue.notes,
        blue.margin_unit, blue.public_domain, blue.app_link, blue.design_link,
        blue.titlepage_frame, blue.titlepage_always, blue.titlepage_blank_back, blue.passage_title, blue.story_emphasis,
        // The whole cover config — it only ever changes atomically (editor Finished / Remove)
        blue.cover,
        item_sigs,
    ])
}

// Recompile right away whenever a discrete field changes. Registered after the watcher above so
// it runs later in the same flush, cancelling whatever debounce that one just queued.
watch(discrete_signature, () => {
    if (!compiles_on_server()){
        compile_debounced.cancel()
        void compile()
    }
})


// Clean up pending work (the pages' object URLs are their component's)
onUnmounted(() => {
    compile_debounced.cancel()
})

</script>


<style lang='sss' scoped>

.preview
    display: flex
    flex-direction: column
    width: 100%
    height: 100%

.toolbar
    flex-shrink: 0
    display: flex
    // Vertically centre the toolbar items — without this the default stretch makes the
    // shorter section toggle fill the toolbar height instead of sitting centred
    align-items: center
    justify-content: center
    gap: 12px
    padding: 8px
    background-color: rgba(0, 0, 0, 0.2)

    // Prompt for the button beside it, allowed to wrap rather than squeeze the section toggle
    // when the preview pane is narrow
    .build_hint
        margin-left: auto
        min-width: 0
        font-size: 15px
        font-weight: bold
        color: rgb(var(--v-theme-secondary-lighten-2))
        text-align: right

        // Slightly larger than the hint so the wave reads clearly beside the button
        .build_arrow
            margin-left: 6px
            font-size: 24px
            vertical-align: middle

    // Active toggle label in brand primary, over its primary-light fill (the toggle
    // sits on the dark preview toolbar)
    :deep(.v-btn-toggle .v-btn--active)
        color: rgb(var(--v-theme-primary))

    // A v-btn-group ignores its children's size and has no density tier below 40px, so
    // set a compact height directly to sit with the size='small' child buttons.
    .sections
        height: 32px

.frame
    position: relative
    flex-grow: 1
    width: 100%
    overflow: hidden

.scroll
    position: absolute
    inset: 0
    overflow-y: auto

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
    // Same animated gradient as the "pending" state in DisplayDesignVersion.vue, scoped to
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
