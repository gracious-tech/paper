
<template lang='pug'>

//- Cover is optional — no cover by default, and removable once added (beside the heading)
div.heading
    h2 {{$t("common.cover")}}
    v-btn(v-if='blue.cover' @click='remove_cover' variant='text' size='small')
        | {{$t("options.cover.remove_cover")}}
//- A picture of the cover that opens the editor: the cover as the desktop's preview last showed
//- it, else its builtin background (image or vector) on the front cover's proportions, else a
//- placeholder cover
button.thumb(v-if='blue.cover' @click='open_editor' type='button')
    img.render(v-if='cover_url' :src='cover_url' alt='' draggable='false')
    div.front(v-else :style='{aspectRatio: front_ratio, backgroundColor: front_color}')
        img(v-if='front_url' :src='front_url' alt='' draggable='false')
        div.placeholder(v-else)
            span.line.title
            span.line.subtitle
    span.overlay {{$t("options.cover.edit_cover")}}
template(v-else)
    p(class='hint') {{$t("options.cover.intro")}}
    v-btn(@click='open_editor' variant='tonal' color='secondary') {{$t("options.cover.add_cover")}}

</template>


<script lang='ts' setup>

import {ref, computed, watch, onUnmounted} from 'vue'
import {resolve_reading_trim} from 'paper-bible-typst'

import {useI18n} from '@/services/i18n'
import {blue, state, confirm_dialog} from '@/services/state'
import {current_design_id} from '@/services/designs'
import {previewed_cover_svg, builtin_bg_800_url, vector_bg_svg, vector_bg_color}
    from '@/services/cover'


const {t} = useI18n()


function svg_url(source:() => string|null|Promise<string|null>){
    // An object URL of the SVG `source` gives, kept current as what it reads changes, the last
    // one released (a slower earlier source never replaces a later one's)
    const url = ref<string|null>(null)
    let latest = 0
    const revoke = () => {
        if (url.value){
            URL.revokeObjectURL(url.value)
        }
    }
    watch(source, async pending => {
        const call = ++latest
        const svg = await pending
        if (call === latest){
            revoke()
            url.value = svg ? URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'})) : null
        }
    }, {immediate: true})
    onUnmounted(revoke)
    return url
}


// The cover as last previewed, while it's still the design's cover. Never rendered for this:
// only a preview that already rendered the cover provides one
const cover_url = svg_url(() => previewed_cover_svg(current_design_id.value, blue.cover))


// Without a previewed cover (always on a phone): a builtin background's small copy, which is
// cheap to show where a custom upload is a full-resolution photo, so those get the placeholder
const bg_url = computed(() => {
    const bg = blue.cover?.bg_image
    return bg?.kind === 'builtin' ? builtin_bg_800_url(bg.id) : null
})


// Else a builtin vector background, coloured as the cover colours it (a small bundled SVG)
const vector_url = svg_url(() => blue.cover ? vector_bg_svg(blue.cover) : null)


// Whichever background there is to show on the front cover's proportions
const front_url = computed(() => bg_url.value ?? vector_url.value ?? undefined)


// The colour a vector is drawn over, as it is on the cover itself
const front_color = computed(() => !bg_url.value && vector_url.value && blue.cover
    ? vector_bg_color(blue.cover) : undefined)


// The front cover's proportions, which the background or placeholder is shown at
const front_ratio = computed(() => {
    const trim = resolve_reading_trim(blue)
    return `${trim.width} / ${trim.height}`
})


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

// The cover's picture, with "Edit cover" shown over it on hover, framed by a thin border (the
// corners clip the picture and its overlay too)
.thumb
    position: relative
    display: block
    max-width: 100%
    padding: 0
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity))
    border-radius: 4px
    overflow: hidden
    background: none

    img.render
        display: block
        max-width: 100%
        max-height: 180px

    // The front cover's shape, filled by the background (its right end, where the front panel
    // of a wraparound sits) or the placeholder. Smaller on a phone, where the editor is the
    // whole screen
    .front
        height: 180px
        @media (max-width: 900px)
            height: 120px

        img
            width: 100%
            height: 100%
            object-fit: cover
            object-position: right center

    // A plain cover in the theme's colour, a shaded spine edge and two lines of title
    .placeholder
        display: flex
        flex-direction: column
        align-items: center
        gap: 8px
        height: 100%
        padding-top: 30%
        background: linear-gradient(160deg, rgba(var(--v-theme-primary), 0.35),
            rgba(var(--v-theme-primary), 0.7))
        box-shadow: inset 6px 0 6px -4px rgba(0, 0, 0, 0.35)

        .line
            height: 6px
            border-radius: 3px
            background-color: rgba(255, 255, 255, 0.85)

        .title
            width: 60%

        .subtitle
            width: 40%
            opacity: 0.7

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

    // Touch screens can't hover, so the label stays, as a strip along the bottom
    @media (hover: none)
        .overlay
            inset: auto 0 0 0
            padding: 4px
            font-size: 13px
            opacity: 1

</style>
