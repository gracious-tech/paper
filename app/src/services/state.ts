
import {reactive, ref, computed} from 'vue'

import {doc_has_copyright} from 'paper-bible-typst'

import {content} from '@/services/content'
import {collect_passage_books} from '@/services/blueprints'

import type {PmDoc} from 'paper-bible-typst'
import type {Blueprint} from '@/services/types'
import type {WizardStep} from '@/services/new_design'


// General state
export const state = reactive({
    // Shows the welcome splash instead of the app — set true by init_designs() for brand new
    // users (no designs yet), cleared by DisplaySplash.vue's "Get Started" button
    splash: false,
    advanced: false,
    editor: null as null|{component:string, props:Record<string, unknown>},
    // A version link the user arrived on for a design they can't edit (shows the read-only
    // "Someone shared this document with you" prompt until confirmed) — set by ViewDesign.vue
    // when a deep-linked design id isn't in the local `designs` list
    viewed_version: null as null|{design_id:string, version_id:string},
    // Whether the user confirmed past the viewed_version prompt (DialogViewedDesign's "View"
    // button) — reveals the regular (read-only) version view; reset whenever viewed_version
    // changes (see DialogViewedDesign.vue)
    viewed_confirmed: false,
    // An edit invite the user followed a link for, awaiting Accept/Ignore before becoming an
    // editor (DialogAcceptInvite handles the prompt) — set by ViewDesignInvite.vue, cleared once
    // resolved either way
    design_invite: null as null|{design_id:string, token:string},
    // Set when the user explicitly chose to keep editing a design that already matches its
    // latest rendered version (the "Edit" button/action) — read by both ViewDesign.vue (which
    // component to show) and AppRoot.vue (which sidebar preview to show), reset whenever the
    // open design changes
    forced_editor: false,
    // Whether the embedded cover editor (cover.paper.bible iframe) is open as a full-window
    // overlay — set by OptionsCover, rendered by DialogCoverEditor (mounted in AppRoot)
    cover_editor: false,
    // Whether the new-design wizard dialog is open — set by AppNavbar's "New" button and by
    // DisplaySplash for brand-new users, rendered by DialogNewDesign (mounted in AppRoot)
    new_design: false,
    // Whether the account dialog is open — set by the header's account button and by any flow
    // that needs a guest to sign in first (e.g. inviting an editor), rendered by DialogAccount
    account: false,
    // Reopens DialogNewDesign in "edit" mode, seeded from the open design's wizard_draft and
    // landing on the given step — set by ViewDesignSimple's Type row (the one wizard step whose
    // change can invalidate another step, so it needs the full stepper's cross-step validation
    // rather than the single-step EditorWizardStep sidebar editor)
    wizard_edit: null as null|{step:WizardStep},
    // Message for a brief snackbar toast (e.g. link copied confirmation), null when hidden
    toast: null as string|null,
    // Pending confirm-dialog request, rendered by DialogConfirm — null hides it (see confirm_dialog())
    confirm: null as null|{message:string, resolve:(confirmed:boolean) => void},
    // Pending prompt-dialog request, rendered by DialogPrompt — null hides it (see prompt_dialog())
    prompt: null as null|{message:string, value:string, resolve:(value:string|null) => void},
    // Pending alert-dialog request, rendered by DialogAlert — null hides it (see alert_dialog()).
    // `action` is an optional extra button label (e.g. "Try again"), resolve(true) when it's
    // clicked and resolve(false) on plain dismissal; `contact_url` optionally adds a "Contact
    // us" link button
    alert: null as null|{message:string, action:string|null, contact_url:string|null,
        resolve:(did_action:boolean) => void},
})


// Show a brief snackbar toast with the given message (auto-dismissed by AppRoot's v-snackbar)
export function show_toast(message:string):void{
    state.toast = message
}


// Ask the user to confirm an action via a Vuetify dialog (replaces the browser's native confirm())
export function confirm_dialog(message:string):Promise<boolean>{
    return new Promise(resolve => {
        state.confirm = {message, resolve}
    })
}


// Ask the user for text input via a Vuetify dialog (replaces the browser's native prompt())
export function prompt_dialog(message:string, initial=''):Promise<string|null>{
    return new Promise(resolve => {
        state.prompt = {message, value: initial, resolve}
    })
}


// Show the user a dismissable message via a Vuetify dialog (replaces the browser's native alert()).
// `action` adds a second button (e.g. "Try again") — resolves true when it's clicked, false when
// the dialog is merely dismissed; `contact_url` adds a "Contact us" link button
export function alert_dialog(message:string, {action, contact_url}:
        {action?:string, contact_url?:string} = {}):Promise<boolean>{
    return new Promise(resolve => {
        state.alert = {message, action: action ?? null, contact_url: contact_url ?? null, resolve}
    })
}


// Open design's blueprint
// NOTE This will actually get init'd once content.collection is available
export const blue = reactive({} as unknown as Blueprint)


// Estimated page count of the full document, refreshed by DisplayPreview after every preview
// compile (exact when the preview wasn't truncated). Page count is a property of the compiled
// interior, never a user setting — versions use the actual count at creation time, while
// anything needed sooner (preview cover spine, binding validity) works from this guess
export const estimated_pages = ref<number|null>(null)


// The current page-count guess, falling back to a plausible book size before the first
// preview compile has produced an estimate
export function page_count_guess():number{
    return estimated_pages.value ?? 300
}


// Whether an interior custom page carries a copyright statement
export const has_interior_copyright = computed(() => {
    return blue.content.some(
        item => item.type === 'custom' && doc_has_copyright(item.doc))
})


// Whether the design carries a copyright statement anywhere — an interior custom page or the
// cover's rear blurb (new covers seed the AUTO-COPYRIGHT marker there by default)
export const has_copyright = computed(() => {
    if (doc_has_copyright(blue.cover?.form['blurb'] as PmDoc | undefined)){
        return true
    }
    return has_interior_copyright.value
})


// Whether current content options require attribution
export const requires_copyright = computed(() => {
    if (blue.notes){
        return true  // TODO Parse restrictions from collection (might have PD ones in future)
    }
    return collect_passage_books(blue.content).length > 0
        && blue.bibles.some(item =>
            !content.translations[item]?.licenses.find(l => !l.restrictions.forbid_attributionless))
})


// Whether any selected translation supports words-of-Jesus markup (red letters)
export const supports_wj = computed(() => {
    return blue.bibles.some(bible => content.wj_markup[bible])
})
