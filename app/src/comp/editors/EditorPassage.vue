
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
    div
        v-text-field(v-model='tmp_title' :label='$t("common.title")')
    div
        v-text-field(v-model='tmp_title_subtitle' :label='$t("common.subtitle")')
    IconField(v-model:icon='tmp_title_icon')
    ImageField(v-model:image='tmp_image')

</template>


<script lang='ts' setup>

import {ref, watch, reactive} from 'vue'

import {blue, state} from '@/services/state'
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
const tmp_title = ref(original?.title ?? '')
const tmp_title_subtitle = ref(original?.title_subtitle ?? '')
const tmp_title_icon = ref<string|null>(original?.title_icon ?? null)
const tmp_image = ref<ContentPassageImage|null>(original?.image ?? null)


// Default the title text + book icon from a freshly resolved reference (new items only, until
// the user types their own) so a fresh passage still shows a sensible heading out of the box
const on_resolved = (reference:string, book:string) => {
    if (!item && !tmp_title.value){
        tmp_title.value = reference
    }
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
            title: tmp_title.value,
            title_subtitle: tmp_title_subtitle.value,
            title_icon: tmp_title_icon.value,
            image: tmp_image.value,
        })
        blue.content.push(item)
    } else {
        Object.assign(item, tmp_passage.value)
    }
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
