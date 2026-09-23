
// Coarse progress readout shared by the in-browser preview (DisplayPreview.vue) and the actual
// version compile (DisplayDesignVersion.vue, driven by compile_and_upload in version_compile.ts).
// Split out so both can show the same "downloading/writing <passage>" wording without one
// depending on the other's component.

import {reactive} from 'vue'

import type {ProgressEvent} from 'paper-bible-typst'
import type {Translate} from '@/services/i18n'


// A progress event from the interior compile, or the app's own 'cover' stage — the cover is
// rendered by bookcover after the interior (see cover.ts), so paper-bible-typst never emits it
export type CompileProgress = ProgressEvent | {stage:'cover'}


// Latest progress event for a version currently compiling in this browser, keyed by version id.
// Only ever holds entries for compiles in flight — compile_and_upload deletes its key once the
// attempt (in-browser or handed off to the server) is done, so a stale event never lingers
export const version_progress = reactive<Record<string, CompileProgress>>({})


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
