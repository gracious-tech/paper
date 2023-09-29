
<template lang='pug'>

v-card(class='ma-4 d-flex flex-column flex-grow-1')

    v-card-title(class='d-flex align-center')
        | Edit passage
        v-spacer
        v-btn(@click='cancel' size='large' variant='text') Cancel
        v-btn(@click='done' :disabled='!tmp_ref || !!errors.length' size='large' variant='text'
            color='secondary') Done

    v-divider

    v-card-text(class='flex-grow-1 d-flex flex-column')
        div
            v-text-field(v-model='tmp_ref' label="Passage" :messages='messages' :error-messages='errors' :hide-details='false')
        div(class='mb-4')
            v-checkbox(v-model='tmp_title' label="Show passage heading")
        h3 Available books
        p(class='text-body-2 text-medium-emphasis mb-4') The following books are available in all selected Bible translations.

        v-list
            v-list-item(v-for='book of available_books' @click='tmp_ref = book')
                v-list-item-title {{ book }}

</template>


<script lang='ts' setup>

import {ref, watch, reactive} from 'vue'
import {passage_str_to_obj, passage_obj_to_str} from '@gracious.tech/fetch-client'

import {blue, state, books_meta} from '@/services/state'
import {content} from '@/services/content'
import {generate_token} from '@/services/utils'

import type {ContentPassage} from '@/services/types'
import {computed} from 'vue'


const props = defineProps<{item:ContentPassage|null}>()


// Create own reference to item so can change without Vue getting upset
let item = props.item


// Keep copy of original so can restore if cancel
const original = props.item ? {...props.item} : null


// Work out human text for ref since that is what will be edited
let initial_ref = ''
if (original){
    initial_ref = passage_obj_to_str(original, books_meta.value[blue.bibles[0]]!)
}


// Edit fields using tmp refs so actual data not changed unless valid
const tmp_ref = ref(initial_ref)
const tmp_title = ref(original?.title ?? true)
const errors = ref([] as string[])
const messages = ref([] as string[])


// Determine which books are available in all selected translations
const available_books = computed(() => {
    const books:string[] = []
    main_loop: for (const book of Object.values(books_meta.value[blue.bibles[0]]!)){
        if (!book.available){
            continue
        }
        for (const bible of blue.bibles.slice(1)){
            if (!books_meta.value[bible]?.[book.id]?.available){
                continue main_loop
            }
        }
        books.push(book.name)
    }
    return books
})


// Watch user's input and auto-apply if valid
watch(tmp_ref, () => {

    // See if ref is valid
    errors.value = []
    messages.value = []
    let ref_obj = passage_str_to_obj(tmp_ref.value, books_meta.value[blue.bibles[0]]!)
    if (!ref_obj && blue.bibles[1]){
        ref_obj = passage_str_to_obj(tmp_ref.value, books_meta.value[blue.bibles[1]]!)
    }
    if (!ref_obj){
        // Fallback on English names if no matches
        ref_obj = passage_str_to_obj(tmp_ref.value, content.collection._manifest.book_names_english)
    }
    if (!ref_obj){
        errors.value = ["Unknown book"]
        return
    }

    // If this is a new content item, need to create
    if (!item){
        item = reactive({
            type: 'passage' as 'passage',
            id: generate_token(),
            ...ref_obj,
            title: tmp_title.value,
        })
        blue.content.push(item)
    } else {
        Object.assign(item, ref_obj)
    }

    // Show detected passage so user can verify correct
    messages.value = [passage_obj_to_str(item, books_meta.value[blue.bibles[0]]!)]
})

watch(tmp_title, () => {
    if (item){
        item.title = tmp_title.value
    }
})

const done = () => {
    state.editor = null
}

const cancel = () => {
    if (original){
        Object.assign(item!, original)
    } else if (item){
        blue.content.splice(blue.content.length-1, 1)
    }
    state.editor = null
}

</script>


<style lang='sass' scoped>

.v-list
    flex-basis: 0
    flex-grow: 1

</style>
