
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{$t("editor.story.edit")}}
    v-spacer
    v-btn(@click='cancel' size='large' variant='text') {{$t("common.cancel")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column overflow-y-auto')
    //- Story-level fields: the optional auto title page (same props as a passage); title also
    //- doubles as the item's label in the content list (see gen_content_name)
    div(class='mb-6 d-flex align-center ga-2')
        v-text-field(v-model='tmp_title_display' :label='$t("common.title")'
            :disabled='tmp_title_auto'
            :placeholder='tmp_title_auto ? tmp_title_placeholder : undefined' persistent-placeholder)
        v-checkbox(v-model='tmp_title_auto' :label='$t("editor.passage.title_auto")'
            hide-details density='compact' class='flex-shrink-0')
    div(class='mb-6')
        v-text-field(v-model='item.title_subtitle' :label='$t("common.subtitle")')
    IconField(v-model:icon='item.title_icon')

    v-divider(class='my-2')

    //- The slides, each rendered as its own page (image + a passage or text body)
    AppDraggableList(:list='item.slides' :item_key='i => i.id' handle='.slide-handle')
        template(#item='{element: slide}')
            v-card.slide(variant='outlined' class='mb-3 pa-3')
                div(class='d-flex align-center mb-2')
                    v-btn-toggle(v-model='slide.mode' mandatory density='compact' variant='outlined')
                        v-btn(value='passage' size='small') {{$t("common.passage")}}
                        v-btn(value='text' size='small') {{$t("common.text")}}
                    v-spacer
                    v-btn(icon variant='text' size='small' class='slide-handle')
                        app-icon(name='drag_indicator')
                    v-btn(icon variant='text' size='small' @click='rm_slide(slide)')
                        app-icon(name='close')
                PassageField(v-if='slide.mode === "passage"' :passage='slide_ref(slide)'
                    @update:passage='val => set_slide_ref(slide, val)' density='compact' variant='plain')
                app-prose(v-else v-model='slide.doc')
                ImageField(v-model:image='slide.image')

    div
        v-btn(@click='add_slide' variant='outlined' size='small') {{$t("editor.story.add_slide")}}

</template>


<script lang='ts' setup>

import {ref, computed, watch} from 'vue'
import {cloneDeep} from 'lodash-es'

import {blue, state} from '@/services/state'
import {generate_token} from '@/services/utils'
import {picture_story_reference} from '@/services/blueprints'
import AppDraggableList from '@/comp/global/AppDraggableList.vue'
import IconField from '@/comp/editors/assets/IconField.vue'
import ImageField from '@/comp/editors/assets/ImageField.vue'
import PassageField from '@/comp/editors/assets/PassageField.vue'

import type {ContentPictureStory, PictureStorySlide} from '@/services/types'
import type {PassageRef} from '@/comp/editors/assets/PassageField.vue'


// The item is always created before the editor opens (see OptionsContent), so it's never null
const props = defineProps<{item:ContentPictureStory}>()
const item = props.item


// Deep copy of the original so a cancel can fully restore nested slide edits
const original = cloneDeep(props.item)
// Whether this item was newly created for this edit (so cancel removes it entirely)
const is_new = item.slides.length === 0 && !item.title


// Same auto/custom title pattern as EditorPassage.vue: tmp_title_auto true keeps the item's
// title null (rendered from a reference spanning its passage-mode slides at compile time),
// false reveals tmp_title as an editable custom title
const tmp_title_auto = ref(item.title === null)
const tmp_title = ref(item.title ?? '')
const tmp_title_placeholder = computed(() => picture_story_reference(item, blue.bibles[0]) ?? '')

// Displays blank while auto (so the placeholder above shows through, rather than a stale custom
// value obscuring it) but still round-trips to tmp_title once the user unchecks auto and types
const tmp_title_display = computed({
    get: () => tmp_title_auto.value ? '' : tmp_title.value,
    set: (val:string) => {
        tmp_title.value = val
    },
})

watch([tmp_title, tmp_title_auto], () => {
    item.title = tmp_title_auto.value ? null : tmp_title.value
})


// Read a slide's flat ref fields as a PassageRef for PassageField (null until a book is set)
const slide_ref = (slide:PictureStorySlide):PassageRef|null => {
    return slide.book ? {
        book: slide.book,
        start_chapter: slide.start_chapter,
        start_verse: slide.start_verse,
        end_chapter: slide.end_chapter,
        end_verse: slide.end_verse,
    } : null
}


// Write a resolved reference back onto the slide's flat fields
const set_slide_ref = (slide:PictureStorySlide, val:PassageRef|null) => {
    if (val){
        Object.assign(slide, val)
    }
}


// Add an empty slide (defaults to passage mode; both bodies exist so toggling never loses input)
const add_slide = () => {
    item.slides.push({
        id: generate_token(),
        image: null,
        mode: 'passage',
        book: '',
        start_chapter: null,
        start_verse: null,
        end_chapter: null,
        end_verse: null,
        doc: {type: 'doc', content: [{type: 'paragraph'}]},
    })
}


// Remove a slide from the story
const rm_slide = (slide:PictureStorySlide) => {
    const index = item.slides.findIndex(s => s.id === slide.id)
    if (index !== -1){
        item.slides.splice(index, 1)
    }
}


const done = () => {
    state.editor = null
}


const cancel = () => {
    if (is_new){
        const index = blue.content.findIndex(i => i.id === item.id)
        if (index !== -1){
            blue.content.splice(index, 1)
        }
    } else {
        // Restore every field, including the whole slides array
        Object.assign(item, cloneDeep(original))
    }
    state.editor = null
}

</script>


<style lang='sss' scoped>

.slide
    background: rgb(var(--v-theme-on-surface), 0.02)

.slide-handle
    cursor: move

</style>
