
<template lang='pug'>

v-card(class='ma-4 d-flex flex-column')

    v-card-title(class='d-flex justify-space-between align-center')
        | Edit title page
        v-btn(@click='done' size='large' variant='text' color='secondary') Done

    v-divider

    v-card-text(class='overflow-y-auto')
        div
            v-text-field(v-model='item.title' label="Title")
        div
            v-text-field(v-model='item.subtitle' label="Subtitle")
        div
            v-combobox.symbol(v-model='item.icon' label="Symbol" :items='biblical_emoji')
                //- Custom item template so font-family applies despite teleport
                template(#item='{props}')
                    v-list-item.symbol-item(v-bind='props')
        div.patterns
            div.none(@click='disable' :class='{active: item.pattern === "none"}') None
            img(v-for='pattern of pattern_items' :src='pattern.src' @click='pattern.click'
                :class='{active: item.pattern === pattern.pattern}')
        v-divider(class='my-8')
        div
            v-checkbox(v-model='item.alone' label="Ensure other side of page blank")
        v-divider(class='my-8')
        div
            p(class='text-body-2 mb-3 text-medium-emphasis') Color of text
            v-color-picker(v-model='item.color_primary' mode='hexa')
        div
            p(class='text-body-2 mb-3 text-medium-emphasis') Color of graphics
            v-color-picker(v-model='item.color_secondary' mode='hexa')


</template>


<script lang='ts' setup>

import patterns from '@/services/patterns'
import {biblical_emoji} from '@/services/emoji'

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

.symbol, .symbol-item
    font-family: "Noto Emoji", Roboto, sans-serif

.symbol :deep() .v-field__input, .symbol-item :deep() .v-list-item-title
    font-size: 40px
    line-height: 1.1


.patterns
    display: flex
    flex-wrap: wrap

    img, .none
        width: 110px
        height: 110px
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
