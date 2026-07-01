
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{$t("Edit text")}}
    v-spacer
    v-btn(@click='cancel' size='large' variant='text') {{$t("Cancel")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column')
    div(class='mb-4')
        v-text-field(v-model='item.name' :placeholder='$t("Label") + "..."')
    app-prose(v-model='item.doc' class='flex-grow-1')
    div(class='mt-4')
        v-checkbox(v-model='item.new_page' :label='$t("Start on new page")')
    div(class='mb-4')
        p(class='text-caption') {{$t("Vertical position on page") + ":"}}
        v-radio-group(v-model='item.position' inline :disabled='!item.new_page')
            v-radio(value='top' :label='$t("Top")')
            v-radio(value='middle' :label='$t("Middle")')
            v-radio(value='bottom' :label='$t("Bottom")')

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
        doc: {type: 'doc', content: [{type: 'paragraph'}]},
        position: 'top',
        new_page: true,
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
