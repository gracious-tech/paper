
<template lang='pug'>

div.preview
    div.toolbar
        v-btn-toggle(:model-value='mode' @update:model-value='set_mode'
            density='compact' variant='elevated' color='secondary' divided mandatory)
            v-btn(v-if='blue.booklet' value='reading' size='small') {{ $t("Reading") }}
            v-btn(value='print' size='small') {{ $t("Print") }}

    iframe(v-if='pdf_url' :src='pdf_url')
    div.status(v-else-if='error_msg')
        h3(class='mb-4') {{ $t("Couldn't generate preview") }}
        p(class='status-detail') {{ error_msg }}
    div.status(v-else)
        p {{ $t("Generating preview") + "…" }}

</template>


<script lang='ts' setup>

import {ref, watch, onUnmounted} from 'vue'
import {debounce} from 'lodash-es'

import {blue} from '@/services/state'
import {content, bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'


// Object URL of the current compiled PDF, and any compile error message
const pdf_url = ref<string|null>(null)
const error_msg = ref<string|null>(null)

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

// Incrementing id so out-of-order async compiles can be discarded
let latest_run = 0


// Compile the current blueprint to a PDF and display it
async function compile(){

    // Wait until the WASM compiler is ready (watcher retriggers when it becomes available)
    const generator = typst_generator.value
    if (!generator){
        return
    }

    const run = ++latest_run
    error_msg.value = null

    try {
        // 'reading' lays out the pages as facing-page book spreads (as if the book were opened);
        // 'print' produces the actual final PDF (booklet fold order, or sequential if not a booklet)
        const request = await bible_content.resolve(blue)
        const bytes = mode.value === 'print'
            ? await generator.compile_pdf(request)
            : await generator.compile_pdf_preview(request)

        // Ignore if a newer compile has started since
        if (run !== latest_run){
            return
        }

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
        error_msg.value = error instanceof Error ? error.message : String(error)
        console.error(error)
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
    padding: 8px
    background-color: rgba(0, 0, 0, 0.2)

iframe
    flex-grow: 1
    width: 100%
    border: none

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
