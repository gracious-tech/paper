
<template lang='pug'>

//- Full-window overlay hosting the external cover editor (the bookcover widget). Deliberately
//- not a v-dialog: those teleport inside the width-capped .v-application, while this must
//- cover the whole viewport (the widget brings its own sidebar + preview)
div.cover_editor(v-if='state.cover_editor')
    iframe(ref='frame' :src='COVER_EDITOR_URL' :title='$t("Cover editor")')
    //- Escape hatch for a wedged/failed iframe only — normal exits are the widget's own
    //- Finished/Cancel buttons
    v-btn.close(v-if='!loaded' @click='state.cover_editor = false' icon variant='elevated'
            size='small' v-tooltip:left='$t("Close")')
        AppIcon(name='close')

</template>


<script lang='ts' setup>

import {ref, toRaw, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import AppIcon from '@/comp/global/AppIcon.vue'
import {blue, state} from '@/services/state'
import {COVER_EDITOR_URL, COVER_EDITOR_ORIGIN, default_cover_preset, load_cover_bg,
    upload_cover_bg, hash_bytes, cover_font_families} from '@/services/cover'
import {custom_fonts, add_custom_fonts} from '@/services/custom_fonts'
import {report_error} from '@/services/errors'
import {cover_form_for_render} from 'paper-bible-typst'

import type {InitMessage, WidgetMessage} from 'bookcover-web'


const {locale} = useI18n()


// The widget iframe (only rendered while the overlay is open)
const frame = ref<HTMLIFrameElement|null>(null)

// Whether the widget has completed the 'ready' handshake (hides the fallback close button)
const loaded = ref(false)


// Answer the widget's 'ready' with the full init message: a complete form preset (stored
// cover, or first-open defaults), the bg image / custom fonts binaries beside it, and the
// embed flags (size UI hidden — the blueprint drives dimensions; Finished/Cancel mode)
const send_init = async () => {
    const frame_window = frame.value?.contentWindow
    if (!frame_window){
        return
    }

    // Preset from the stored cover form (with the blueprint's current size fields overlaid)
    // or the defaults for a brand new cover (book title, book icon, credit blurb)
    const cover = blue.cover
    const preset = cover ? cover_form_for_render(cover, blue) : default_cover_preset(blue)

    // Restore the stored bg image as a File beside the pure-JSON preset
    let bg_image:File|null = null
    if (cover){
        const image = await load_cover_bg(cover)
        if (image){
            bg_image = new File([image.data as BlobPart], 'background', {type: image.type})
        }
    }

    const message:InitMessage = {
        type: 'init',
        // JSON round-trip so no Vue reactive proxies reach structured clone
        preset: JSON.parse(JSON.stringify(preset)) as InitMessage['preset'],
        bg_image,
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

        // Upload the bg image only when its content actually changed (content-addressed)
        let bg_image_path:string|null = null
        let bg_image_hash:string|null = null
        if (message.bg_image){
            const bytes = new Uint8Array(await message.bg_image.arrayBuffer())
            const hash = await hash_bytes(bytes)
            if (hash === blue.cover?.bg_image_hash && blue.cover.bg_image_path){
                bg_image_path = blue.cover.bg_image_path
                bg_image_hash = hash
            } else {
                ({path: bg_image_path, hash: bg_image_hash} =
                    await upload_cover_bg(bytes, message.bg_image.type))
            }
        }

        const form = message.data as unknown as Record<string, unknown>
        blue.cover = {form, bg_image_path, bg_image_hash,
            font_families: cover_font_families(form)}
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

    iframe
        width: 100%
        height: 100%
        border: none

    .close
        position: absolute
        top: 12px
        right: 12px

</style>
