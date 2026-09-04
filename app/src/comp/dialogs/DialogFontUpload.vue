
<template lang='pug'>

v-dialog(v-model='dialog' activator='parent' max-width='420' :fullscreen='is_mobile')
    v-card
        template(#title) {{$t("dialog.fonts.upload")}}
        template(#text)
            div(class='d-flex flex-column ga-4 text-body-medium')

                //- Instructions
                div(class='d-flex flex-column ga-1')
                    p(class='font-weight-bold') {{$t("dialog.fonts.google_howto")}}
                    ol(class='d-flex flex-column ga-1 pl-4')
                        li
                            | {{$t("dialog.fonts.visit")}}
                            |
                            a(href='https://fonts.google.com' target='_blank'
                                rel='noopener') fonts.google.com
                            |
                            | {{$t("dialog.fonts.find_family")}}
                        li {{$t('dialog.fonts.get_font_step')}}
                        li {{$t("dialog.fonts.upload_zip")}}

                //- Drop/click file upload area
                label(class='drop-area' :class='{dragging: is_dragging}'
                    @dragenter.prevent='is_dragging = true' @dragover.prevent='is_dragging = true'
                    @dragleave.prevent='is_dragging = false' @drop.prevent='on_drop')
                    AppIcon(name='upload')
                    span {{$t("dialog.fonts.drop_files")}}
                    span(class='text-body-small text-medium-emphasis') .zip, .ttf, .otf
                    input(ref='file_input' type='file' accept='.zip,.ttf,.otf' multiple
                        class='d-none' @change='on_file_select')

                //- Status message
                div(v-if='status' class='d-flex align-center ga-1 text-body-small'
                    :class='status_error ? "text-error" : "text-medium-emphasis"') {{ status }}

        template(#actions)
            v-spacer
            v-btn(@click='dialog = false') {{$t("common.close")}}

</template>


<script lang='ts' setup>

// DialogFontUpload — upload custom font files (zip or individual .ttf/.otf), used as a child
// of the button that should trigger it (see AppFontSelect.vue), matching DialogPeddlers.vue's
// plain activator='parent' pattern

import {ref} from 'vue'
import {useI18n} from '@/services/i18n'

import {upload_custom_fonts} from '@/services/custom_fonts'
import {use_is_mobile} from '@/services/display'

import AppIcon from '@/comp/global/AppIcon.vue'


const emit = defineEmits<{
    (e:'font-added', family:string):void
}>()

const {t} = useI18n()

// Fullscreen on mobile (instructions + dropzone fill most of a phone screen)
const is_mobile = use_is_mobile()

const dialog = ref(false)
const is_dragging = ref(false)
const status = ref('')
const status_error = ref(false)


// Process a set of selected/dropped files, closing the dialog and emitting the first newly-
// added family on success
async function handle_files(files:File[]):Promise<void> {
    if (!files.length){
        return
    }
    status.value = t("dialog.fonts.processing")
    status_error.value = false
    try {
        const added = await upload_custom_fonts(files)
        if (added.length){
            emit('font-added', added[0]!)
            dialog.value = false
            status.value = ''
        } else {
            status.value = t("dialog.fonts.none_found")
            status_error.value = true
        }
    } catch (error){
        console.error(error)
        status.value = t("dialog.fonts.process_failed")
        status_error.value = true
    }
}

// @ts-ignore TS6133 — used in the Pug template
function on_file_select(event:Event):void {
    const input = event.target as HTMLInputElement
    if (input.files){
        void handle_files([...input.files])
        input.value = ''
    }
}

// @ts-ignore TS6133 — used in the Pug template
function on_drop(event:DragEvent):void {
    is_dragging.value = false
    if (event.dataTransfer?.files){
        void handle_files([...event.dataTransfer.files])
    }
}

</script>


<style lang='sass' scoped>

.drop-area
    display: flex
    flex-direction: column
    align-items: center
    gap: 8px
    padding: 24px
    border: 2px dashed rgba(0, 0, 0, 0.24)
    border-radius: 8px
    cursor: pointer
    text-align: center

    &.dragging
        border-color: rgb(var(--v-theme-primary))

    &:hover
        background: rgba(0, 0, 0, 0.03)

</style>
