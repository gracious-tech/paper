
<template lang='pug'>

v-card(:class='{selected}' variant='outlined' @click='emit("select")')
    img(:src='image' alt='' :style='ratio ? {aspectRatio: String(ratio)} : undefined')
    div.text(:class='tint')
        strong {{ label }}
        div.subtitle(v-if='subtitle') {{ subtitle }}

</template>


<script lang='ts' setup>


// A selectable image card for the new-design wizard's choice grids (type/print/cover steps)
// `tint` optionally colors the text area to distinguish sub-categories (e.g. text vs picture
// designs in the type step). `ratio` overrides the default 2:1 box (width/height) — used by the
// cover step's live previews, which must match the actual chosen book size's cover proportions
defineProps<{image:string, label:string, subtitle?:string, selected:boolean, tint?:'blue'|'yellow',
    ratio?:number|undefined}>()
const emit = defineEmits<{(e:'select'):void}>()


</script>


<style lang='sass' scoped>

.v-card
    cursor: pointer

    &.selected
        border-color: rgb(var(--v-theme-secondary))
        background-color: rgba(var(--v-theme-secondary), 0.08)

    img
        display: block
        width: 100%
        aspect-ratio: 2 / 1
        object-fit: cover
        background-color: rgba(var(--v-theme-primary), 0.08)

    .text
        padding: 8px 12px 10px 12px

        &.blue
            background-color: #e3f0ff

        &.yellow
            background-color: #fdf6d8

        .subtitle
            font-size: 0.8rem
            opacity: 0.7

</style>
