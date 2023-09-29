
<template lang='pug'>

component(v-if='editor' :is='editor_component' v-bind='editor.props')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {state} from '@/services/state'
import EditorPassage from '@/comp/editors/EditorPassage.vue'
import EditorCustom from '@/comp/editors/EditorCustom.vue'
import EditorBible from '@/comp/editors/EditorBible.vue'
import EditorTitle from '@/comp/editors/EditorTitle.vue'

import type {Component} from 'vue'


const components:Record<string, Component> = {EditorPassage, EditorCustom, EditorBible, EditorTitle}

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
