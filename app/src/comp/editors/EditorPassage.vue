
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{$t("Edit passage")}}
    v-spacer
    v-btn(@click='cancel' size='large' variant='text') {{$t("Cancel")}}
    v-btn(@click='done' :disabled='!tmp_ref || !!errors.length' size='large' variant='text'
        color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column')
    div
        v-text-field(v-model='tmp_ref' :label='$t("Book or passage")' :messages='messages'
            :error-messages='errors' :hide-details='false')
    div
        v-text-field(v-model='tmp_title' :label='$t("Title")')
    div
        v-text-field(v-model='tmp_title_subtitle' :label='$t("Subtitle")')
    IconField(v-model:icon='tmp_title_icon')
    h3 {{$t("Available books")}}
    p(class='text-body-2 text-medium-emphasis mb-4') {{$t("Some may be missing if a translation you have selected only has one testament, or is still being translated or digitized.")}}

    v-list
        v-list-item(v-for='book of available_books' @click='tmp_ref = book' density='compact')
            v-list-item-title {{ book }}

</template>


<script lang='ts' setup>

import {ref, watch, reactive, computed} from 'vue'
import {PassageReference} from '@gracious.tech/fetch-client'

import {blue, state} from '@/services/state'
import {content} from '@/services/content'
import {generate_token} from '@/services/utils'
import {book_icon} from '@/services/icons'
import IconField from '@/comp/editors/assets/IconField.vue'

import type {ContentPassage} from '@/services/types'


const props = defineProps<{item:ContentPassage|null}>()


// Create own reference to item so can change without Vue getting upset
let item = props.item


// Keep copy of original so can restore if cancel
const original = props.item ? {...props.item} : null


// Work out human text for ref since that is what will be edited
let initial_ref = ''
if (original){
    initial_ref = content.collection.reference_to_string(
        new PassageReference(original), blue.bibles[0])
}


// Edit fields using tmp refs so actual data not changed unless valid
const tmp_ref = ref(initial_ref)
const tmp_title = ref(original?.title ?? '')
const tmp_title_subtitle = ref(original?.title_subtitle ?? '')
const tmp_title_icon = ref<string|null>(original?.title_icon ?? null)
const errors = ref([] as string[])
const messages = ref([] as string[])


// Determine which books are available in all selected translations
const available_books = computed(() => {
    const books:string[] = []
    main_loop: for (const book of Object.values(content.books[blue.bibles[0]]!)){
        if (!book.available){
            continue
        }
        for (const bible of blue.bibles.slice(1)){
            if (!content.books[bible]?.[book.id]?.available){
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
    let ref_obj = content.collection.string_to_reference(tmp_ref.value, blue.bibles[0])
    if (!ref_obj && blue.bibles[1]){
        // See if matches a book name in second translation (in case different language)
        ref_obj = content.collection.string_to_reference(tmp_ref.value, blue.bibles[1])
    }
    if (!ref_obj){
        errors.value = ["Unknown book"]
        return
    }

    // Common props whether updating or creating
    // NOTE Saving args generated for PassageReference so can reconstruct correct ref type later
    const common_props = {
        book: ref_obj.book,
        start_chapter: ref_obj._args.start_chapter ?? null,  // DB type excludes undefined
        start_verse: ref_obj._args.start_verse ?? null,
        end_chapter: ref_obj._args.end_chapter ?? null,
        end_verse: ref_obj._args.end_verse ?? null,
    }

    // Detected passage reference, used both for the confirmation message and as the default
    // title text (until the user types their own) so a fresh passage still shows a sensible
    // heading out of the box, matching the pre-redesign auto-derived heading behaviour
    const reference = content.collection.reference_to_string(ref_obj, blue.bibles[0])
    if (!item && !tmp_title.value){
        tmp_title.value = reference
    }
    // Default the title icon to the passage's book icon, until the user picks their own
    if (!item && !tmp_title_icon.value){
        tmp_title_icon.value = book_icon[ref_obj.book] ?? null
    }

    // If this is a new content item, need to create
    if (!item){
        item = reactive({
            type: 'passage' as 'passage',
            id: generate_token(),
            ...common_props,
            title: tmp_title.value,
            title_subtitle: tmp_title_subtitle.value,
            title_icon: tmp_title_icon.value,
        })
        blue.content.push(item)
    } else {
        Object.assign(item, common_props)
    }

    // Show detected passage so user can verify correct
    messages.value = [reference]
})

watch(tmp_title, () => {
    if (item){
        item.title = tmp_title.value
    }
})

watch(tmp_title_subtitle, () => {
    if (item){
        item.title_subtitle = tmp_title_subtitle.value
    }
})

watch(tmp_title_icon, () => {
    if (item){
        item.title_icon = tmp_title_icon.value
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
