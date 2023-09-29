
<template lang='pug'>

v-card(class='ma-4 d-flex flex-column flex-grow-1')

    v-card-title(class='d-flex align-center')
        | Edit text
        v-spacer
        v-btn(@click='cancel' size='large' variant='text') Cancel
        v-btn(@click='done' size='large' variant='text' color='secondary') Done

    v-divider

    v-card-text(class='flex-grow-1 d-flex flex-column')
        div(class='mb-4')
            v-text-field(v-model='item.name' placeholder="Label...")
        app-html(v-model='item.html' class='flex-grow-1')
        div(class='my-4')
            p(class='text-caption') Vertical position on page:
            v-radio-group(v-model='item.position' inline)
                v-radio(value='top' label="Top")
                v-radio(value='middle' label="Middle")
                v-radio(value='bottom' label="Bottom")

</template>


<script lang='ts' setup>

import {reactive} from 'vue'

import {blue, state} from '@/services/state'
import {generate_token} from '@/services/utils'

import type {ContentCustom} from '@/services/types'


const props = defineProps<{item:ContentCustom|null}>()


// Keep copy of original so can restore if cancel
const original = props.item ? {...props.item} : null


// Create if a new item
let item = props.item!
if (!item){
    item = reactive({
        type: 'custom',
        id: generate_token(),
        name: '',
        html: '',
        position: 'top',
    } as ContentCustom)
    blue.content.push(item)
}


const done = () => {
    state.editor = null
}


const cancel = () => {
    if (original){
        Object.assign(item, original)
    } else {
        blue.content.splice(blue.content.length-1, 1)
    }
    state.editor = null
}

</script>


<style lang='sass' scoped>


</style>
