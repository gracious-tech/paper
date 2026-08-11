
<template lang='pug'>

v-card(v-if='editor' class='ma-4 d-flex flex-column flex-grow-1')
    component(:is='editor_component' v-bind='editor.props')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {state} from '@/services/state'
import EditorPassage from '@/comp/editors/EditorPassage.vue'
import EditorCustom from '@/comp/editors/EditorCustom.vue'
import EditorBible from '@/comp/editors/EditorBible.vue'
import EditorTitle from '@/comp/editors/EditorTitle.vue'
import EditorPictureStory from '@/comp/editors/EditorPictureStory.vue'
import EditorAdvancedStyles from '@/comp/editors/EditorAdvancedStyles.vue'
import EditorWizardStep from '@/comp/editors/EditorWizardStep.vue'

import type {Component} from 'vue'


const components:Record<string, Component> = {
    EditorPassage, EditorCustom, EditorBible, EditorTitle, EditorPictureStory,
    EditorAdvancedStyles, EditorWizardStep,
}

const editor = computed(() => {
    return state.editor
})

const editor_component = computed(() => {
    if (!state.editor){
        return undefined
    }
    if (!components[state.editor.component]){
        throw new Error(`Editor component not defined: ${state.editor.component}`)
    }
    return components[state.editor.component]
})

</script>


<style lang='sass' scoped>


</style>
