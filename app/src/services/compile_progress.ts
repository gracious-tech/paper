
// Coarse progress readout shared by the in-browser preview (DisplayPreview.vue) and the actual
// version compile (DisplayDesignVersion.vue, driven by compile_and_upload in version_compile.ts).
// Split out so both can show the same "downloading/writing <passage>" wording without one
// depending on the other's component. Also tracks whether any generation is in flight in this tab,
// so leaving the page mid-compile can be warned about (see hold_page).

import {reactive, ref, computed} from 'vue'

import type {ProgressEvent} from 'paper-bible-typst'
import type {Translate} from '@/services/i18n'


// A progress event from the interior compile, or the app's own 'cover' stage — the cover is
// rendered by bookcover after the interior (see cover.ts), so paper-bible-typst never emits it
export type CompileProgress = ProgressEvent | {stage:'cover'}


// Latest progress event for a version currently compiling in this browser, keyed by version id.
// Only ever holds entries for compiles in flight — compile_and_upload deletes its key once the
// attempt (in-browser or handed off to the server) is done, so a stale event never lingers
export const version_progress = reactive<Record<string, CompileProgress>>({})


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


// Map a coarse progress event to translated display text. Only a handful of stages are
// meaningful to a user watching a compile progress; the rest (e.g. 'arrange', the booklet/spread
// imposition step) return null so the caller just keeps showing whatever it last showed rather
// than flashing an unrelated message
export function stage_text(event:CompileProgress, t:Translate):string|null {
    if (event.stage === 'cover'){
        return t("display.preview.preparing_cover") + "…"
    }
    if (event.stage === 'start'){
        return t("display.preview.getting_started") + "…"
    }
    if (event.stage === 'fetch'){
        return `${t("display.preview.downloading")} ${event.label} (${event.i}/${event.total})`
    }
    if (event.stage === 'compile'){
        return `${t("display.preview.writing")} ${event.label} (${event.i}/${event.total})`
    }
    if (event.stage === 'finalize'){
        return t("display.preview.final_touches") + "…"
    }
    return null
}
