<template lang='pug'>

//- Passage image field: choose an external URL or upload an image, shown as a thumbnail with a
//- clear button once set — mirrors IconField.vue's compact trigger+thumbnail pattern
div.image-field
    label.image-label {{$t("common.image")}}
    div.image-row
        template(v-if='image')
            img.thumb(:src='image.url ?? ""' alt='')
            span(class='text-body-small text-medium-emphasis') {{ status_text }}
            v-btn(icon variant='text' size='small' :aria-label='$t("editor.image.remove")' @click='clear')
                AppIcon(name='close')
        template(v-else)
            v-btn-toggle(v-model='mode' mandatory density='compact' variant='outlined')
                v-btn(value='upload' size='small') {{$t("common.upload")}}
                v-btn(value='url' size='small') {{$t("editor.image.url")}}
            label.upload-btn(v-if='mode === "upload"' :class='{uploading}')
                AppIcon(name='upload')
                span {{ uploading ? $t("editor.image.uploading") : $t("editor.image.choose_file") }}
                input(type='file' accept='image/jpeg,image/png,image/webp' class='d-none'
                    :disabled='uploading' @change='on_file_select')
            v-text-field(v-else v-model='url_input' :label='$t("editor.image.url_label")' hide-details
                density='compact' @keyup.enter='apply_url' @blur='apply_url')
    p(v-if='error' class='text-body-small text-error mt-1') {{ error }}

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'

import {upload_passage_image} from '@/services/content_images'
import AppIcon from '@/comp/global/AppIcon.vue'

import type {ContentPassageImage} from '@/services/types'


// Two-way binding: the chosen image config (null = none)
const image = defineModel<ContentPassageImage|null>('image', {required: true})

const {t} = useI18n()


// Source picker (only shown while no image is set yet)
const mode = ref<'upload'|'url'>(image.value?.source ?? 'upload')
const url_input = ref(image.value?.source === 'url' ? (image.value.url ?? '') : '')
const uploading = ref(false)
const error = ref('')


// Short label under the thumbnail, so it's clear where the current image came from
const status_text = computed(() => {
    return image.value?.source === 'url' ? t("editor.image.from_url") : t("editor.image.uploaded")
})


// Read the chosen file and upload it, replacing the model with the resulting image config
async function on_file_select(event:Event):Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file){
        return
    }
    uploading.value = true
    error.value = ''
    try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        image.value = await upload_passage_image(bytes, file.type)
    } catch (err){
        console.error(err)
        error.value = t("editor.image.upload_failed")
    } finally {
        uploading.value = false
    }
}


// Commit the typed URL as the image config (empty = no image)
function apply_url():void {
    const url = url_input.value.trim()
    image.value = url ? {source: 'url', url, path: null, hash: null} : null
}


// Clear the current image and reset back to the picker
function clear():void {
    image.value = null
    url_input.value = ''
    mode.value = 'upload'
}

</script>


<style lang='sass' scoped>

.image-field
    margin-bottom: 24px

    .image-label
        display: block
        font-size: 0.75rem
        font-weight: 600
        margin-bottom: 6px

    .image-row
        display: flex
        align-items: center
        gap: 8px

        .thumb
            width: 40px
            height: 40px
            object-fit: cover
            border-radius: 4px

    .upload-btn
        display: flex
        align-items: center
        gap: 6px
        padding: 6px 12px
        border: 1px dashed rgb(var(--v-theme-on-surface), 0.3)
        border-radius: 6px
        cursor: pointer
        font-size: 0.8rem

        &:hover
            background: rgb(var(--v-theme-on-surface), 0.06)

        &.uploading
            opacity: 0.6
            cursor: default

</style>
