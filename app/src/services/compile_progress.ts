
// Coarse progress readout shared by the in-browser preview (DisplayPreview.vue) and the actual
// version compile (DisplayDesignVersion.vue, driven by compile_and_upload in version_compile.ts).
// Split out so both can show the same "downloading/writing <passage>" wording without one
// depending on the other's component. Also tracks whether any generation is in flight in this tab,
// so leaving the page mid-compile can be warned about (see hold_page).

import {reactive, ref, computed} from 'vue'

import type {ProgressEvent} from 'paper-bible-typst'
import type {Translate} from '@/services/i18n'


// A progress event from the interior compile, or one of the app's own stages: 'cover' (rendered
// by bookcover after the interior, see cover.ts, so paper-bible-typst never emits it), 'queued'
// (waiting for this tab's previous build, see claim_compile_turn) and 'offline' (waiting for a
// connection to publish or hand over what's been done, see network_retry.ts)
export type CompileProgress = ProgressEvent | {stage:'cover'} | {stage:'queued'}
    | {stage:'offline'}


// Latest progress event for a version currently compiling in this browser, keyed by version id.
// Only ever holds entries for compiles in flight — compile_and_upload deletes its key once the
// attempt (in-browser or handed off to the server) is done, so a stale event never lingers
export const version_progress = reactive<Record<string, CompileProgress>>({})


// Versions Build it was clicked for in this tab, by the id they'll be created under, with their
// design and when it was clicked. The click goes straight to the version's page while the page
// estimate and the freeze still run, so the version views show it as preparing until its doc
// arrives, and time the wait from the click rather than the doc's own stamp (which would restart
// the clock). Removed when a build fails before its version exists, or when a retry or
// regeneration of the version starts an attempt of its own
export const build_requests = reactive<Record<string, {design_id:string, clicked:number}>>({})


// How many generations currently depend on this tab staying open — work done here in the browser
// that nothing else would pick up if the page went away (once a compile is handed to the server
// it no longer counts, since the server finishes it regardless). A plain count rather than a set
// of ids, since freezing a version holds the page before it has an id
const page_holds = ref(0)


// Whether leaving the page (or switching account) right now would interrupt a generation
export const generating_here = computed(() => page_holds.value > 0)


function warn_before_unload(event:BeforeUnloadEvent):void {
    // Ask the browser to confirm leaving (it shows its own generic wording — a page can't supply
    // any). preventDefault is the standard way; returnValue is what older browsers look for
    event.preventDefault()
    event.returnValue = true
}


export function hold_page():() => void {
    // Mark a generation as depending on this tab, returning a release function. The unload
    // listener is only attached while something is held, since a beforeunload listener can stop
    // the browser keeping the page in its back/forward cache. Releasing twice is harmless, so a
    // caller can release early (e.g. on handing off to the server) and again in a finally block
    page_holds.value += 1
    if (page_holds.value === 1){
        addEventListener('beforeunload', warn_before_unload)
    }
    let released = false
    return () => {
        if (released){
            return
        }
        released = true
        page_holds.value -= 1
        if (page_holds.value === 0){
            removeEventListener('beforeunload', warn_before_unload)
        }
    }
}


// The tail of this tab's queue of version compiles, resolving once every turn claimed so far has
// been released, and how many turns are held or waiting. Builds run in the browser one at a time:
// a phone can't hold two documents' compilers at once, nor a cover's beside a book's, and a second
// build started mid-compile (edit, then build again) would otherwise push the first one's cover
// onto the server for want of memory
let compile_queue:Promise<void> = Promise.resolve()
const compile_turns = ref(0)


// Whether a version compile is running (or waiting to) in this tab
export const compiling_here = computed(() => compile_turns.value > 0)


export function claim_compile_turn():Promise<() => void> {
    // Wait for every earlier turn to be released, then hold the browser's compiler until the
    // returned function is called. Releasing twice is harmless, like hold_page's release
    let release_queue!:() => void
    const released = new Promise<void>(resolve => {
        release_queue = resolve
    })
    const turn = compile_queue.then(() => undefined)
    compile_queue = turn.then(() => released)
    compile_turns.value += 1
    let done = false
    const release = () => {
        if (!done){
            done = true
            compile_turns.value -= 1
            release_queue()
        }
    }
    return turn.then(() => release)
}


// Map a coarse progress event to translated display text. Only a handful of stages are
// meaningful to a user watching a compile progress; the rest (e.g. 'arrange', the booklet/spread
// imposition step) return null so the caller just keeps showing whatever it last showed rather
// than flashing an unrelated message
export function stage_text(event:CompileProgress, t:Translate):string|null {
    if (event.stage === 'cover'){
        return t("display.preview.preparing_cover") + "…"
    }
    if (event.stage === 'offline'){
        return t("display.preview.waiting_online") + "…"
    }
    if (event.stage === 'queued'){
        return t("display.preview.waiting_previous") + "…"
    }
    if (event.stage === 'start'){
        return t("display.preview.getting_started") + "…"
    }
    // Fetch and compile events always carry the book (label) and the step counts
    const step = {label: event.label ?? '', i: event.i ?? 0, total: event.total ?? 0}
    if (event.stage === 'fetch'){
        return t("display.preview.downloading", step)
    }
    if (event.stage === 'compile'){
        return t("display.preview.writing", step)
    }
    if (event.stage === 'finalize'){
        return t("display.preview.final_touches") + "…"
    }
    return null
}
