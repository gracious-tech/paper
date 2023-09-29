
<template lang='pug'>

v-list(bg-color='transparent')
    v-list-item(@click='() => change(0)')
        v-list-item-title {{ primary_title }}
        template(#append)
            v-btn(v-if='!secondary_absent' icon variant='text' @click.stop='rm_primary')
                app-icon(name='close')
    v-list-item(@click='() => change(1)')
        v-list-item-title(:class='{"text-disabled": secondary_absent}') {{ secondary_title }}
        template(#append)
            v-btn(v-if='!secondary_absent' icon variant='text' @click.stop='rm_secondary')
                app-icon(name='close')

div(v-if='warnings' class='mt-4 text-error text-body-2')
    div(v-for='warning of warnings') {{ warning }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue, state, translations_have_passages} from '@/services/state'

import {content} from '@/services/content'


const primary_title = computed(() => {
    const trans = content.translations[blue.bibles[0]!]!
    return trans.name_local || trans.name_english
})

const secondary_title = computed(() => {
    if (!blue.bibles[1]){
        return "Add additional translation"
    }
    const trans = content.translations[blue.bibles[1]]!
    return trans.name_local || trans.name_english
})

const secondary_absent = computed(() => {
    return !blue.bibles[1]
})

const warnings = computed(() => {
    const items:string[] = []
    if (!translations_have_passages.value){
        items.push("These translations do not all have the passages chosen")
    }
    return items
})

const rm_primary = () => {
    blue.bibles.splice(0, 1)
}

const rm_secondary = () => {
    blue.bibles.splice(1, 1)
}

const change = (index:number) => {
    state.editor = {
        component: 'EditorBible',
        props: {
            bibles_index: index,
        },
    }
}


</script>


<style lang='sass' scoped>


</style>
