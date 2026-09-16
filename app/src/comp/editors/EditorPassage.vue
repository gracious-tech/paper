
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{$t("editor.passage.edit")}}
    v-spacer
    v-btn(@click='cancel' size='large' variant='text') {{$t("common.cancel")}}
    v-btn(@click='done' :disabled='!tmp_passage || passage_error' size='large' variant='text'
        color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column')
    PassageField(v-model:passage='tmp_passage' v-model:error='passage_error'
        @resolved='on_resolved')

    v-divider(class='my-4')

    //- Fields below control the passage's auto-generated title (title page or inline heading,
    //- per the document-wide passage-title setting)
    h2(class='text-title-medium text-center mb-6') {{$t("editor.passage.title_appearance")}}

    div(class='mb-6 d-flex align-center ga-2')
        v-text-field(v-model='tmp_title_display' variant='underlined' :label='$t("common.title")'
            :disabled='tmp_title_auto'
            :placeholder='tmp_title_auto ? tmp_title_placeholder : undefined' persistent-placeholder)
        v-checkbox(v-model='tmp_title_auto' :label='$t("editor.passage.title_auto")'
            hide-details density='compact' class='flex-shrink-0')
    div(class='mb-6')
        v-text-field(v-model='tmp_title_subtitle' variant='underlined' :label='$t("common.subtitle")')
    IconField(v-model:icon='tmp_title_icon')
    ImageField(v-model:image='tmp_image')

</template>


<script lang='ts' setup>

import {ref, computed, watch, reactive} from 'vue'
import {PassageReference} from '@gracious.tech/fetch-client'

import {blue, state} from '@/services/state'
import {content} from '@/services/content'
import {generate_token} from '@/services/utils'
import {book_icon} from '@/services/icons'
import IconField from '@/comp/editors/assets/IconField.vue'
import ImageField from '@/comp/editors/assets/ImageField.vue'
import PassageField from '@/comp/editors/assets/PassageField.vue'

import type {ContentPassage, ContentPassageImage} from '@/services/types'
import type {PassageRef} from '@/comp/editors/assets/PassageField.vue'


const props = defineProps<{item:ContentPassage|null}>()


// Create own reference to item so can change without Vue getting upset
let item = props.item


// Keep copy of original so can restore if cancel
const original = props.item ? {...props.item} : null


// Edit fields using tmp refs so actual data not changed unless valid. The reference itself is
// parsed by PassageField, which only sets tmp_passage once a valid reference is entered
const tmp_passage = ref<PassageRef|null>(original
    ? {book: original.book, start_chapter: original.start_chapter,
        start_verse: original.start_verse, end_chapter: original.end_chapter,
        end_verse: original.end_verse}
    : null)
const passage_error = ref(false)
// tmp_title_auto tracks the "Auto" checkbox: true means the item's title stays null (rendered
// from the passage reference at compile time), false reveals tmp_title as an editable custom
// title. New items default to auto; an existing item's own null/string state decides for it
const tmp_title_auto = ref(original ? original.title === null : true)
const tmp_title = ref(original?.title ?? '')
const tmp_title_subtitle = ref(original?.title_subtitle ?? '')
const tmp_title_icon = ref<string|null>(original?.title_icon ?? null)
const tmp_image = ref<ContentPassageImage|null>(original?.image ?? null)


// Live preview of what the "Auto" title resolves to, shown as the title field's placeholder
const tmp_title_placeholder = computed(() => tmp_passage.value
    ? content.collection.reference_to_string(new PassageReference(tmp_passage.value), blue.bibles[0])
    : '')

// Displays blank while auto (so the placeholder above shows through, rather than a stale custom
// value obscuring it) but still round-trips to tmp_title once the user unchecks auto and types
const tmp_title_display = computed({
    get: () => tmp_title_auto.value ? '' : tmp_title.value,
    set: (val:string) => {
        tmp_title.value = val
    },
})

// The title's effective value to write to the item: null while auto, else the custom text
const compute_title = ():string|null => tmp_title_auto.value ? null : tmp_title.value

// Default the book icon from a freshly resolved reference (new items only)
const on_resolved = (_reference:string, book:string) => {
    if (!item && !tmp_title_icon.value){
        tmp_title_icon.value = book_icon[book] ?? null
    }
}


// Create the item on first valid reference, or apply ref changes to the existing item
watch(tmp_passage, () => {
    if (!tmp_passage.value){
        return
    }
    if (!item){
        item = reactive({
            type: 'passage' as 'passage',
            id: generate_token(),
            ...tmp_passage.value,
            title: compute_title(),
            title_subtitle: tmp_title_subtitle.value,
            title_icon: tmp_title_icon.value,
            image: tmp_image.value,
        })
        blue.content.push(item)
    } else {
        Object.assign(item, tmp_passage.value)
    }
})

watch([tmp_title, tmp_title_auto], () => {
    if (item){
        item.title = compute_title()
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

watch(tmp_image, () => {
    if (item){
        item.image = tmp_image.value
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


</style>
