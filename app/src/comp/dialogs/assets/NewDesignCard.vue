
<template lang='pug'>

v-card(:class='{selected, square}' variant='outlined' @click='emit("select")')
    img(v-if='image' :src='image' alt=''
        :style='ratio ? {aspectRatio: String(ratio)} : undefined')
    //- No preview yet — still rendering, or its render failed
    div.pending(v-else :style='ratio ? {aspectRatio: String(ratio)} : undefined')
    //- The label comes back whenever there's no preview, so a card with nothing to show is
    //- still identifiable and selectable
    div.text(v-if='!hide_label || !image' :class='tint')
        strong {{ label }}
        div.subtitle(v-if='subtitle') {{ subtitle }}

</template>


<script lang='ts' setup>


// A selectable image card for the new-design wizard's choice grids (type/print/cover steps)
// `tint` optionally colors the text area to distinguish sub-categories (e.g. text vs picture
// designs in the type step). `ratio` overrides the default 2:1 box (width/height) — used by the
// cover step's live previews, which must match the actual chosen book size's cover proportions.
// `hide_label` drops the text area entirely (the cover step's previews speak for themselves),
// though it's ignored while there's no image to speak for itself. `image` is optional for the
// same reason: the cover step renders its previews live, so there's a moment before the first
// one arrives — and no static stand-in, which would only ever show a cover that isn't theirs.
// `square` removes the corner rounding (cover step only — a book cover has square corners)
defineProps<{image?:string|undefined, label:string, subtitle?:string, selected:boolean,
    tint?:'blue'|'yellow', ratio?:number|undefined, hide_label?:boolean, square?:boolean}>()
const emit = defineEmits<{(e:'select'):void}>()


</script>


<style lang='sss' scoped>

.v-card
    cursor: pointer

    &.square
        border-radius: 0

    &.selected
        border-color: rgb(var(--v-theme-secondary))
        background-color: rgba(var(--v-theme-secondary), 0.08)

    img, .pending
        display: block
        width: 100%
        aspect-ratio: 2 / 1
        object-fit: cover
        background-color: rgba(var(--v-theme-primary), 0.08)

    // Gently pulsed so an empty box reads as "coming" rather than "broken"
    .pending
        animation: pending_pulse 1.6s ease-in-out infinite

    .text
        padding: 8px 12px 10px 12px

        &.blue
            background-color: #e3f0ff

        &.yellow
            background-color: #fdf6d8

        .subtitle
            font-size: 0.8rem
            opacity: 0.7

@keyframes pending_pulse
    50%
        background-color: rgba(var(--v-theme-primary), 0.16)

</style>
