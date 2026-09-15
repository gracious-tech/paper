
<template lang='pug'>

//- Full-window overlay hosting the external cover editor (the bookcover widget). Deliberately
//- not a v-dialog: those teleport inside the width-capped .v-application, while this must
//- cover the whole viewport (the widget brings its own sidebar + preview)
div.cover_editor(v-if='state.cover_editor')
    iframe(ref='frame' :src='COVER_EDITOR_URL' :title='$t("dialog.cover.title")')
    //- Escape hatch for a wedged/failed iframe only — normal exits are the widget's own
    //- Finished/Cancel buttons
    v-btn.close(v-if='!loaded' @click='state.cover_editor = false' icon variant='text' color='white'
            size='small' v-tooltip:left='$t("common.close")')
        AppIcon(name='close')

</template>


<script lang='ts' setup>

import {ref, toRaw, watch} from 'vue'
import {useI18n} from '@/services/i18n'

import AppIcon from '@/comp/global/AppIcon.vue'
import {blue, state, page_count_guess} from '@/services/state'
import {COVER_EDITOR_URL, COVER_EDITOR_ORIGIN, default_cover_preset, load_cover_bg,
    upload_cover_bg, hash_bytes, cover_font_families} from '@/services/cover'
import {custom_fonts, add_custom_fonts} from '@/services/custom_fonts'
import {report_error} from '@/services/errors'
import {cover_form_for_render, get_cover_title, get_cover_title_from_form, is_builtin_background}
    from 'paper-bible-typst'

import type {EmbedFormState} from 'bookcover-core'
import type {InitMessage, WidgetMessage} from 'bookcover-web'
import type {CoverConfig} from '@/services/types'


const {locale} = useI18n()


// The widget iframe (only rendered while the overlay is open)
const frame = ref<HTMLIFrameElement|null>(null)

// Whether the widget has completed the 'ready' handshake (hides the fallback close button)
const loaded = ref(false)

// Content hash of the bg image bytes last sent to the widget via send_init(), so
// handle_finished() can tell an unchanged upload (echoed back byte-for-byte) from a genuinely
// new one, and skip re-uploading identical bytes under a fresh Storage path. Only used for
// uploads now — a builtin identifies itself via the widget's bg_image_builtin field
let sent_bg_hash:string|null = null


// Answer the widget's 'ready' with the full init message: a complete form preset (stored
// cover, or first-open defaults), the bg image / custom fonts binaries beside it, and the
// embed flags (size UI hidden — the blueprint drives dimensions; Finished/Cancel mode)
const send_init = async () => {
    const frame_window = frame.value?.contentWindow
    if (!frame_window){
        return
    }

    // Preset from the stored cover form (with the blueprint's current size fields and the
    // estimated page count overlaid) or the defaults for a brand new cover (book title, book
    // icon, credit blurb)
    const cover = blue.cover
    const preset = cover
        ? cover_form_for_render(cover, blue, page_count_guess())
        : default_cover_preset(blue)

    // Restore the stored bg image as a File beside the pure-JSON preset, named after the
    // builtin id when applicable so the widget's own fast color lookup can match it too.
    // A builtin is also named explicitly via bg_image_builtin: without it the widget has only
    // the bytes, and would report the restored image back as an upload on its first message
    let bg_image:File|null = null
    let bg_image_builtin:string|null = null
    sent_bg_hash = null
    if (cover?.bg_image){
        const image = await load_cover_bg(cover)
        if (image){
            const builtin = cover.bg_image.kind === 'builtin' ? cover.bg_image.id : null
            bg_image = new File([image.data as BlobPart], builtin ?? 'background',
                {type: image.type})
            bg_image_builtin = builtin
            // Only uploads need byte-identity tracking (see handle_finished)
            sent_bg_hash = cover.bg_image.kind === 'custom' ? cover.bg_image.hash : null
        }
    }

    const message:InitMessage = {
        type: 'init',
        // JSON round-trip so no Vue reactive proxies reach structured clone
        preset: JSON.parse(JSON.stringify(preset)) as Partial<EmbedFormState>,
        bg_image,
        bg_image_builtin,
        // The user's whole font library, so cover fonts match what the book can use
        custom_fonts: [...toRaw(custom_fonts)],
        finished_mode: true,
        hide_size_section: true,
        locale: locale.value.startsWith('vi') ? 'vie' : 'eng',
    }
    frame_window.postMessage(message, COVER_EDITOR_ORIGIN)
    loaded.value = true
}


// Persist the widget's final state onto the design: merge any widget-uploaded fonts into the
// user's library, upload the bg image if its content changed, then store the cover config on
// the blueprint (designs.ts autosaves it and bumps save_token like any other edit)
const handle_finished = async (
    message:Extract<WidgetMessage, {type:'finished'}>,
):Promise<void> => {
    try {
        // Fonts uploaded inside the widget become part of the user's library (deduped)
        if (message.custom_fonts.length){
            await add_custom_fonts(message.custom_fonts)
        }

        // Resolve the bg image's identity. A builtin the widget names is stored as a reference
        // — no bytes kept, since it's already durably hosted in the public assets bucket. The
        // name is advisory and untrusted (the widget is a separate origin), so it's shape-checked
        // first; anything malformed falls through to being treated as an upload. An upload is
        // content-addressed, and re-uploading is skipped when the bytes came back unchanged, so
        // merely opening and closing the editor never mints a new Storage path
        let bg_image:CoverConfig['bg_image'] = null
        if (message.bg_image_builtin && is_builtin_background(message.bg_image_builtin)){
            bg_image = {kind: 'builtin', id: message.bg_image_builtin}
        } else if (message.bg_image){
            const bytes = new Uint8Array(await message.bg_image.arrayBuffer())
            const hash = await hash_bytes(bytes)
            if (hash === sent_bg_hash && blue.cover?.bg_image){
                bg_image = blue.cover.bg_image
            } else {
                const {path, hash: new_hash} = await upload_cover_bg(bytes, message.bg_image.type)
                bg_image = {kind: 'custom', path, hash: new_hash}
            }
        }

        const form = message.data as unknown as Record<string, unknown>
        // Editing any of the cover's title lines here makes the title the user's own, so it
        // stops following later renames of the design. An unchanged title leaves the flag as it
        // was — merely opening and saving the editor shouldn't detach it
        const title_custom = blue.cover?.title_custom
            || get_cover_title_from_form(form) !== get_cover_title(blue.cover)
        blue.cover = {form, bg_image, font_families: cover_font_families(form), title_custom}
    } catch (error){
        report_error('banner', error)
    }
    state.cover_editor = false
}


// Handle widget messages — only from the expected origin AND our own iframe (the widget
// itself doesn't validate parents, so this check is the security boundary)
const on_message = (event:MessageEvent) => {
    if (event.origin !== COVER_EDITOR_ORIGIN || !frame.value
            || event.source !== frame.value.contentWindow){
        return
    }
    const message = event.data as WidgetMessage
    if (message.type === 'ready'){
        void send_init()
    } else if (message.type === 'cancelled'){
        // The widget confirmed discarding any edits itself
        state.cover_editor = false
    } else if (message.type === 'finished'){
        void handle_finished(message)
    }
    // 'data' messages are ignored — 'finished' carries the complete authoritative state
}


// Listen while the overlay is open (fresh handshake per open)
watch(() => state.cover_editor, open => {
    if (open){
        loaded.value = false
        window.addEventListener('message', on_message)
    } else {
        window.removeEventListener('message', on_message)
    }
})

</script>


<style lang='sass' scoped>

.cover_editor
    position: fixed
    inset: 0
    z-index: 3000
    background-color: #fff
    box-sizing: border-box

    // On desktop leave a gap around the iframe and blur the app behind it, so opening the
    // widget reads as a panel over the app rather than a full navigation away from it (mobile
    // has no room to spare so stays edge-to-edge)
    @media (min-width: 901px)
        padding: 24px
        background-color: rgba(0, 0, 0, 0.4)
        backdrop-filter: blur(6px)

    iframe
        display: block
        width: 100%
        height: 100%
        border: none
        @media (min-width: 901px)
            border-radius: 8px
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3)

    .close
        position: absolute
        top: 12px
        right: 12px
        @media (min-width: 901px)
            top: 36px
            right: 36px

</style>
