
<template lang='pug'>

v-dialog(:model-value='modelValue' @update:model-value='close' max-width='420')
    v-card
        v-card-title {{$t("Category")}}
        v-card-text
            v-combobox(v-model='selected' :items='categories' :label='$t("Category")'
                    autofocus clearable hide-details)
        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("Cancel")}}
            v-btn(@click='save' variant='tonal' color='primary') {{$t("Save")}}

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'

import {designs, set_design_category} from '@/services/designs'


const props = defineProps<{modelValue:boolean, id:string, categories:string[]}>()
const emit = defineEmits<{(event:'update:modelValue', value:boolean):void}>()


// The combobox's current value — either an existing category name or freshly typed text; null
// clears the design's category
const selected = ref(null as string|null)


// Prefill with the design's current category every time the dialog opens
watch(() => props.modelValue, open => {
    if (open){
        selected.value = designs.find(item => item.id === props.id)?.category ?? null
    }
})


const save = async () => {
    const trimmed = selected.value?.trim() || null
    await set_design_category(props.id, trimmed)
    emit('update:modelValue', false)
}

const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sass' scoped>

</style>
