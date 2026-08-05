
<template lang='pug'>

//- Passage reference picker: a free-text field parsed by the fetch-client into flat ref fields,
//- with the detected reference echoed back and a warning if a selected translation doesn't
//- include the chosen book
div.passage-field
    v-text-field(v-model='tmp_ref' :label='$t("Book or passage")' :messages='messages'
        :error-messages='errors' :hide-details='false')
    div(v-if='warnings.length' class='mt-2 text-error text-body-medium')
        div(v-for='warning of warnings') {{ warning }}

</template>


<script lang='ts' setup>

import {ref, watch, computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {PassageReference} from '@gracious.tech/fetch-client'

import {blue} from '@/services/state'
import {content} from '@/services/content'
import {missing_book_warnings} from '@/services/blueprints'

import type {ContentPassage} from '@/services/types'


// The subset of passage fields this field resolves (shared by ContentPassage and picture-story
// slides). null until a valid reference has been entered
export type PassageRef = Pick<ContentPassage,
    'book'|'start_chapter'|'start_verse'|'end_chapter'|'end_verse'>


// Two-way bindings: the parsed reference, and whether the current input is invalid (so a parent
// can disable its "Done" button while the text doesn't resolve)
const passage = defineModel<PassageRef|null>('passage', {required: true})
const error = defineModel<boolean>('error', {required: false, default: false})


// Emitted when a valid reference resolves, so a parent can derive default title/icon text
const emit = defineEmits<{resolved:[reference:string, book:string]}>()

const {t} = useI18n()


// Human text for the current reference (what the user edits) — seeded from any existing ref
let initial_ref = ''
if (passage.value){
    initial_ref = content.collection.reference_to_string(
        new PassageReference(passage.value), blue.bibles[0])
}
const tmp_ref = ref(initial_ref)
const errors = ref([] as string[])
const messages = ref([] as string[])


// Warn if any selected translation doesn't include the currently chosen book
const warnings = computed(() => {
    if (!passage.value){
        return []
    }
    return missing_book_warnings([passage.value.book], blue.bibles, t)
})


// Watch user's input and emit the parsed reference if valid
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
        error.value = true
        return
    }
    error.value = false

    // NOTE Saving args generated for PassageReference so can reconstruct correct ref type later
    passage.value = {
        book: ref_obj.book,
        start_chapter: ref_obj._args.start_chapter ?? null,  // DB type excludes undefined
        start_verse: ref_obj._args.start_verse ?? null,
        end_chapter: ref_obj._args.end_chapter ?? null,
        end_verse: ref_obj._args.end_verse ?? null,
    }

    // Show detected passage so user can verify correct, and let parents default title/icon
    const reference = content.collection.reference_to_string(ref_obj, blue.bibles[0])
    messages.value = [reference]
    emit('resolved', reference, ref_obj.book)
})

</script>


<style lang='sass' scoped>

</style>
