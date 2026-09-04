<template lang='pug'>

//- Icon picker: sample/selected thumbnails + text input open a popover grid of suggestions,
//- with an inline size slider and clear button once an icon is chosen
div.icon-field
    label.icon-label {{$t("common.icon")}}
    div.icon-row
        v-menu(v-model='picker_open' :close-on-content-click='false' location='bottom start')
            template(#activator='{props}')
                div.icon-trigger(v-bind='props' :class='{grow: !icon || picker_open}')
                    div.thumbs
                        template(v-if='!icon')
                            img.thumb(v-for='ic of preview_icons' :key='ic.id' :src='ic.url'
                                :alt='ic.id')
                        img.thumb(v-else :src='selected_icon_url' :alt='icon')
                    input.icon-input(v-if='picker_open' ref='input_ref' :value='icon ?? ""'
                        type='text' :placeholder='$t("editor.icon.enter_id")'
                        @input='on_input' @click.stop @mousedown.stop)
                    span.icon-placeholder(v-else-if='!icon'
                        @click.stop='picker_open = true') {{$t("editor.icon.choose")}}
            //- Popover content: scrollable grid of all suggestions + a "More" button
            v-card.icon-menu
                div.icon-grid
                    button.icon-cell(v-for='ic of icons' :key='ic.id' type='button'
                        :class='{active: icon === ic.id}' :title='ic.id' @click='select(ic.id)')
                        img(:src='ic.url' :alt='ic.id')
                    button.icon-more(type='button' @click.stop='help_open = true') {{$t("common.more")}}
        //- Size multiplier — inline, only when a caller binds a size model (some icons, e.g.
        //- title-page icons, use a single global size setting instead of a per-icon one)
        v-slider.icon-size(v-if='icon && !picker_open && size !== undefined' v-model='size'
            :min='0.4' :max='2' :step='0.1' thumb-label hide-details
            :aria-label='$t("common.icon_size")')
            template(#thumb-label='{modelValue}')
                | {{Number(modelValue).toFixed(1)}}x
        //- Clear button — only when an icon is selected and the popover is closed
        v-btn(v-if='icon && !picker_open' icon variant='text' size='small'
            :aria-label='$t("editor.icon.remove")' @click='icon = null')
            AppIcon(name='close')
    DialogIconHelp(v-model:open='help_open')

</template>


<script lang='ts' setup>

import {computed, nextTick, ref, watch} from 'vue'

import {biblical_icons} from '@/services/icons'
import DialogIconHelp from '@/comp/dialogs/DialogIconHelp.vue'


// Two-way bindings: the chosen Iconify ID (or raw SVG) and its size multiplier. size is
// optional — some callers (e.g. title-page icons) use a single global size setting instead of
// binding a per-icon one, so the slider is simply omitted when no size model is provided
const icon = defineModel<string|null>('icon', {required: true})
const size = defineModel<number|undefined>('size', {required: false})


// Build a preview URL for an Iconify ID (or a pasted raw SVG) via the Iconify SVG API
const icon_url = (id:string):string => {
    if (id.trimStart().startsWith('<')){
        return `data:image/svg+xml,${encodeURIComponent(id)}`
    }
    const [collection, name] = id.split(':')
    return `https://api.iconify.design/${collection}/${name}.svg`
}


// All suggested icons with preview URLs, plus the first few shown as trigger thumbnails
const icons = biblical_icons.map(id => ({id, url: icon_url(id)}))
const preview_icons = icons.slice(0, 4)


// Preview URL for the currently-selected icon
const selected_icon_url = computed(() => icon.value ? icon_url(icon.value) : '')


// Popover + help-dialog open state, and a ref to focus the text input when the popover opens
const picker_open = ref(false)
const help_open = ref(false)
const input_ref = ref<HTMLInputElement|null>(null)
watch(picker_open, open => {
    if (open){
        nextTick(() => input_ref.value?.focus())
    }
})


// Sync the text input to the model, treating an empty string as no icon
const on_input = (e:Event) => {
    const val = (e.target as HTMLInputElement).value
    icon.value = val || null
}


// Select a suggested icon and close the popover
const select = (id:string) => {
    icon.value = id
    picker_open.value = false
}


</script>


<style lang='sass' scoped>

.icon-field
    margin-bottom: 24px

    .icon-label
        display: block
        font-size: 0.75rem
        font-weight: 600
        margin-bottom: 6px

    .icon-row
        display: flex
        align-items: center
        gap: 8px

    //- Inline size slider fills the space left of the clear button
    .icon-size
        flex: 1

    //- Trigger row: sample/selected thumbnails + text input
    .icon-trigger
        display: flex
        align-items: center
        gap: 8px
        cursor: pointer
        min-width: 0

        //- Grows to fill the row while choosing (no icon, or popover open)
        &.grow
            flex: 1

        &:hover
            opacity: 0.85

        .thumbs
            display: flex
            gap: 4px
            flex-shrink: 0

            .thumb
                width: 40px
                height: 40px
                padding: 4px

        .icon-input
            flex: 1
            min-width: 0
            font-size: 0.8rem
            padding: 6px 8px
            border: 1px solid rgb(var(--v-theme-on-surface), 0.22)
            border-radius: 6px
            outline: none

        .icon-placeholder
            flex: 1
            font-size: 0.875rem
            padding: 6px 8px
            color: rgb(var(--v-theme-on-surface), 0.6)


//- Popover content is teleported but keeps this component's scope attribute, so styles apply
.icon-menu
    padding: 8px
    overflow-y: auto
    max-height: min(320px, 60dvh)

    .icon-grid
        display: grid
        grid-template-columns: repeat(6, 48px)
        gap: 6px

        .icon-cell
            width: 48px
            height: 48px
            padding: 6px
            border-radius: 6px
            border: 2px solid transparent
            cursor: pointer
            background: none

            img
                width: 100%
                height: 100%

            &:hover
                background: rgb(var(--v-theme-on-surface), 0.06)

            &.active
                border-color: rgb(var(--v-theme-secondary))

        .icon-more
            grid-column: span 2
            height: 48px
            border-radius: 6px
            border: none
            background: none
            cursor: pointer
            font-weight: 700
            color: rgb(var(--v-theme-secondary))

            &:hover
                background: rgb(var(--v-theme-on-surface), 0.06)


</style>
