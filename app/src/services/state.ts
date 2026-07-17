
import {reactive, computed} from 'vue'

import {doc_has_copyright} from 'paper-bible-typst'

import {content} from '@/services/content'

import type {Blueprint, ContentPassage} from '@/services/types'


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
    // Message for a brief snackbar toast (e.g. link copied confirmation), null when hidden
    toast: null as string|null,
    // Pending confirm-dialog request, rendered by DialogConfirm — null hides it (see confirm_dialog())
    confirm: null as null|{message:string, resolve:(confirmed:boolean) => void},
    // Pending prompt-dialog request, rendered by DialogPrompt — null hides it (see prompt_dialog())
    prompt: null as null|{message:string, value:string, resolve:(value:string|null) => void},
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


// Open design's blueprint
// NOTE This will actually get init'd once content.collection is available
export const blue = reactive({} as unknown as Blueprint)


// Whether current blueprint includes a copyright item
export const has_copyright = computed(() => {
    return blue.content.some(
        item => item.type === 'custom' && doc_has_copyright(item.doc))
})


// Whether current content options require attribution
export const requires_copyright = computed(() => {
    if (blue.notes){
        return true  // TODO Parse restrictions from collection (might have PD ones in future)
    }
    return blue.content.some(item => item.type === 'passage')
        && blue.bibles.some(item =>
            !content.translations[item]?.licenses.find(l => !l.restrictions.forbid_attributionless))
})


// Whether any selected translation supports words-of-Jesus markup (red letters)
export const supports_wj = computed(() => {
    return blue.bibles.some(bible => content.wj_markup[bible])
})


// Whether all passages are available in all translations
export const translations_have_passages = computed(() => {
    return blue.bibles.every(bible => {
        return blue.content.filter(i => i.type === 'passage').every(p => {
            const book = (p as ContentPassage).book
            return content.books[bible]?.[book]?.available
        })
    })
})
