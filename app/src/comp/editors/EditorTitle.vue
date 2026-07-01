<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("Edit title page")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='overflow-y-auto')
    div
        v-text-field(v-model='item.title' :label='$t("Title")')
    div
        v-text-field(v-model='item.subtitle' :label='$t("Subtitle")')
    IconField(v-model:icon='item.icon' v-model:size='item.icon_size')
    div.patterns
        div.none(@click='disable' :class='{active: item.pattern === "none"}') {{$t("None")}}
        img(v-for='pattern of pattern_items' :src='pattern.src' @click='pattern.click'
            :class='{active: item.pattern === pattern.pattern}')

    v-divider(class='my-8')

    div(class='mb-4')
        AppColor(v-model='item.color_primary' :label='$t("Color of text")')
    div(class='mb-4')
        AppColor(v-model='item.color_secondary' :label='$t("Color of graphics")')
    div
        v-checkbox(v-model='item.alone' :label='$t("Ensure other side of page blank")')
    p(class='text-body-2 text-medium-emphasis') {{$t("Title pages can look nicer when nothing on the other side shows through the paper.")}}


</template>


<script lang='ts' setup>

import {PATTERNS as patterns} from 'paper-bible-typst'
import IconField from '@/comp/editors/assets/IconField.vue'

import type {ContentTitle} from '@/services/types'
import {state} from '@/services/state'


const props = defineProps<{item:ContentTitle}>()


const disable = () => {
    props.item.pattern = 'none'
}


const pattern_items = Object.entries(patterns).map(([pattern, svg]) => {
    return {
        pattern,
        src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
        click(){
            props.item.pattern = pattern
        },
    }
})


const done = () => {
    state.editor = null
}



</script>


<style lang='sass' scoped>

.v-card-text
    padding-bottom: 30vh


.v-text-field, .v-color-picker
    margin-bottom: 24px


.patterns
    display: flex
    flex-wrap: wrap

    img, .none
        width: 90px
        height: 90px
        cursor: pointer
        margin: 6px

        &:hover
            outline: 1px solid rgb(var(--v-theme-primary), 0.3)

        &.active
            outline: 2px solid rgb(var(--v-theme-secondary))

    .none
        display: inline-flex
        justify-content: center
        align-items: center


</style>
