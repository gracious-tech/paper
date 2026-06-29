
<template lang="pug">

//- Color picker: a button whose background is the chosen color, with contrast-aware text
//- and an optional clear button
div.app-color(:class='{empty: !modelValue}'
    :style='modelValue ? {background: modelValue, color: contrast_color} : {}')
    //- Label wraps a hidden native color input that opens the OS picker on click
    label.swatch
        input(type="color" :value='modelValue ?? "#000000"' @input='on_input')
        span.label {{label}}
    //- Clear button, only shown when clearable and a color is set
    button.clear(v-if='clearable && modelValue' type="button"
        :aria-label='$t("Clear color")' @click='emit("update:modelValue", null)')
        AppIcon(name='close')

</template>


<script setup lang="ts">

// AppColor — button whose background is the chosen color, with contrast-aware text

import {computed, ref} from 'vue'


const props = withDefaults(defineProps<{
    modelValue:string|null|undefined
    label?:string
    clearable?:boolean
}>(), {
    label: '',
    clearable: true,
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


// Debounce timer so we emit only after a period of no changes
const debounce_timer = ref<ReturnType<typeof setTimeout>|null>(null)

// Debounce color input: emit to v-model only after a period of no changes
function on_input(event:Event):void{
    const value = (event.target as HTMLInputElement).value
    if (debounce_timer.value !== null){
        clearTimeout(debounce_timer.value)
    }
    debounce_timer.value = setTimeout(() => emit('update:modelValue', value), 800)
}

</script>


<style lang="sass" scoped>

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
