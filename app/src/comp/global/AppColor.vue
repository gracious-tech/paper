
<template lang="pug">

//- Color picker: a button whose background is the chosen color and which opens the Coloris
//- picker (bound globally via [data-coloris] — see services/coloris.ts), with contrast-aware
//- label text. Clearing back to the default is offered as an "Auto" button beside the field,
//- or an X inside it when clear_mode is "none"
div.app-color-wrap
    div.app-color(:class='{empty: !modelValue}'
        :style='modelValue ? {background: modelValue, color: contrast_color} : {}')
        //- Label wraps a hidden text input that Coloris binds to and writes the picked color into
        label.swatch
            input(type="text" data-coloris readonly :value='modelValue ?? ""' @input='on_input')
            span.label {{label}}
        //- X button — only when a discrete "none" is a valid target (clear_mode="none")
        button.clear(v-if='show_x' type="button"
            :aria-label='$t("Clear color")' @click='emit("update:modelValue", null)')
            AppIcon(name='close')
    //- "Auto" button — revert to the app-derived default (clear_mode="auto")
    v-btn.auto(v-if='show_auto' type="button" variant='outlined' size='small'
        @click='emit("update:modelValue", null)') {{$t("Auto")}}

</template>


<script setup lang="ts">

// AppColor — button whose background is the chosen color, with contrast-aware text

import {computed, ref, onUnmounted} from 'vue'


const props = withDefaults(defineProps<{
    modelValue:string|null|undefined
    label?:string
    // 'auto': clearing reverts to the app default, offered as an "Auto" button beside the field
    // 'none': clearing sets a discrete "no color", offered as an X inside the field
    // (bookcover also has an 'auto_none' mode; unused here as no blueprint field needs it)
    clear_mode?:'auto'|'none'
}>(), {
    label: '',
    clear_mode: 'auto',
})

const emit = defineEmits<{
    (e:'update:modelValue', value:string|null):void
}>()


// White or black text, whichever contrasts more against the chosen color (ITU-R BT.601)
// @ts-ignore TS6133 — used in the Pug template; Volar can't trace Pug bindings
const contrast_color = computed(() => {
    if (!props.modelValue){
        return ''
    }
    const hex = props.modelValue.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    return (0.299 * r + 0.587 * g + 0.114 * b) > 0.5 ? '#000000' : '#ffffff'
})

// X button: shown only in "none" mode, and only when there's a color to clear
// @ts-ignore TS6133 — used in the Pug template; Volar can't trace Pug bindings
const show_x = computed(() => props.clear_mode === 'none' && props.modelValue != null)

// "Auto" button: shown only in "auto" mode, and only when a color is currently set
// @ts-ignore TS6133 — used in the Pug template; Volar can't trace Pug bindings
const show_auto = computed(() => props.clear_mode === 'auto' && props.modelValue != null)


// Debounce timer so we emit only after a period of no changes, plus the value awaiting emit
const debounce_timer = ref<ReturnType<typeof setTimeout>|null>(null)
let pending_value:string|null = null

// Debounce color input: emit to v-model only after a period of no changes
function on_input(event:Event):void{
    pending_value = (event.target as HTMLInputElement).value
    if (debounce_timer.value !== null){
        clearTimeout(debounce_timer.value)
    }
    debounce_timer.value = setTimeout(() => {
        debounce_timer.value = null
        emit('update:modelValue', pending_value)
    }, 800)
}

// Flush a pending debounced pick immediately on unmount (e.g. the advanced-styles panel
// closing right after a pick) — otherwise Vue's emit() silently no-ops once the component is
// unmounted and the change is lost with no error
onUnmounted(() => {
    if (debounce_timer.value === null){
        return
    }
    clearTimeout(debounce_timer.value)
    emit('update:modelValue', pending_value)
})

</script>


<style lang="sass" scoped>

.app-color-wrap
    display: inline-flex
    align-items: center
    gap: 8px
    max-width: 100%

.app-color
    display: inline-flex
    align-items: center
    width: fit-content
    min-width: 200px
    max-width: 100%
    border-radius: 4px
    overflow: hidden

    &.empty
        border: thin solid rgba(0, 0, 0, 0.38)

    .swatch
        position: relative
        display: flex
        align-items: center
        gap: 6px
        flex: 1
        height: 28px
        padding: 0 10px
        font-size: 0.875rem
        font-weight: 500
        cursor: pointer
        user-select: none

        input
            position: absolute
            inset: 0
            width: 100%
            height: 100%
            opacity: 0
            cursor: pointer

        .label
            position: relative
            pointer-events: none

    .clear
        display: flex
        align-items: center
        height: 28px
        padding: 0 6px
        cursor: pointer

        :deep(.icon)
            width: 14px
            height: 14px

</style>
