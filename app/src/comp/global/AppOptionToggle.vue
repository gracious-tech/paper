
<template lang='pug'>

//- AppOptionToggle — a labelled single-select rendered as a segmented button group, for the
//- short mutually-exclusive choices in the standard Options panels (replaces inline
//- v-radio-group where every label is a word or two). Always keeps one option selected.
div(class='option-toggle')
    div(v-if='props.label' class='option-toggle-label') {{ props.label }}
    v-btn-toggle(:model-value='model' @update:model-value='on_update' :disabled='props.disabled'
            variant='outlined' divided mandatory role='group' :aria-label='props.label')
        v-btn(v-for='opt in props.items' :key='opt.value' :value='opt.value')
            | {{ opt.title }}

</template>


<script lang='ts' setup>

// One selectable option: the stored string value and its visible label
interface ToggleItem {
    value:string
    title:string
}


const props = defineProps<{
    label?:string
    items:ToggleItem[]
    disabled?:boolean
}>()


// The selected value — always a string, mirroring the string-wrapped computeds callers pass
const model = defineModel<string>({required: true})


// Commit a new selection, ignoring the empty emission Vuetify can send mid-toggle (mandatory
// should prevent it, but guard so the model never goes undefined)
function on_update(value:string|undefined):void{
    if (value === undefined || value === null){
        return
    }
    model.value = value
}

</script>


<style lang='sass' scoped>

// Vertical spacing is left to the caller (same margin utilities the old radio groups used).
// Label matches Vuetify's v-radio-group label: 1rem, and the same 0.75 opacity the global
// .v-label override in styles.sass applies (not text-medium-emphasis's lower 0.6)
.option-toggle-label
    margin-bottom: 0.75rem
    font-size: 1rem
    opacity: 0.75

</style>
