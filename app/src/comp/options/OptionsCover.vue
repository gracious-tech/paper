
<template lang='pug'>

//- Cover is optional — no cover by default, and removable once added (beside the heading)
div.heading
    h2 {{$t("common.cover")}}
    v-btn(v-if='blue.cover' @click='remove_cover' variant='text' size='small')
        | {{$t("options.cover.remove_cover")}}
template(v-if='blue.cover')
    //- The cover as the desktop's preview last showed it, which opens the editor when clicked,
    //- else a note that there is one
    button.thumb(v-if='cover_url' @click='open_editor' type='button')
        img(:src='cover_url' alt='' draggable='false')
        span.overlay {{$t("options.cover.edit_cover")}}
    template(v-else)
        p(class='hint') {{$t("options.cover.has_cover")}}
        v-btn(@click='open_editor' variant='tonal' color='secondary')
            | {{$t("options.cover.edit_cover")}}
template(v-else)
    p(class='hint') {{$t("options.cover.intro")}}
    v-btn(@click='open_editor' variant='tonal' color='secondary') {{$t("options.cover.add_cover")}}

</template>


<script lang='ts' setup>

import {ref, watch, onUnmounted} from 'vue'

import {useI18n} from '@/services/i18n'
import {blue, state, confirm_dialog} from '@/services/state'
import {current_design_id} from '@/services/designs'
import {previewed_cover_svg} from '@/services/cover'


const {t} = useI18n()


// An object URL of the cover as last previewed, while it's still the design's cover. Never
// rendered for this: only a preview that already rendered the cover provides one
const cover_url = ref<string|null>(null)

watch(() => previewed_cover_svg(current_design_id.value, blue.cover), svg => {
    revoke()
    cover_url.value = svg ? URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'})) : null
}, {immediate: true})

onUnmounted(revoke)


// Release the thumbnail's object URL
function revoke():void{
    if (cover_url.value){
        URL.revokeObjectURL(cover_url.value)
    }
}


// Open the embedded cover editor as a full-window overlay (DialogCoverEditor)
const open_editor = () => {
    state.cover_editor = true
}


// Remove the cover from the design (the config is discarded, not just disabled)
const remove_cover = async () => {
    if (await confirm_dialog(t("options.cover.remove_confirm"))){
        blue.cover = null
    }
}

</script>


<style lang='sss' scoped>

// The section's heading, with the remove action at its right end
.heading
    display: flex
    align-items: center
    justify-content: space-between
    margin-bottom: 12px

    h2
        font-size: 18px

// The cover's picture, with "Edit cover" shown over it on hover, and nothing of the button around
// it
.thumb
    position: relative
    display: block
    max-width: 100%
    padding: 0
    border: none
    background: none

    img
        display: block
        max-width: 100%
        max-height: 180px

    .overlay
        position: absolute
        inset: 0
        display: flex
        align-items: center
        justify-content: center
        background-color: rgba(0, 0, 0, 0.5)
        color: white
        font-weight: 500
        opacity: 0
        transition: opacity 0.15s

    &:hover .overlay, &:focus-visible .overlay
        opacity: 1

</style>
