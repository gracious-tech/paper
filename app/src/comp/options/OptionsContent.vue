
<template lang='pug'>

v-list(bg-color='transparent')
    AppDraggableList(:list='blue.content' :item_key='i => i.id' handle='.handle')
        template(#item='{element}')
            v-list-item(@click='() => edit(element)')
                template(#prepend)
                    v-chip(class='mr-3 text-primary') {{ type_label[element.type] }}
                template(#append)
                    v-btn(icon variant='text' class='handle')
                        app-icon(name='drag_indicator')
                    v-btn(icon variant='text' @click='rm_content(element)')
                        app-icon(name='close')
                v-list-item-title {{ gen_content_name(element) }}

div.add(class='d-flex align-center flex-wrap')
    strong(class='text-medium-emphasis mr-2') {{$t("common.add")}}
    v-btn(@click='add_passage' size='small' variant='outlined') {{$t("common.passage")}}
    v-btn(@click='add_custom' size='small' variant='outlined') {{$t("common.text")}}
    v-btn(@click='add_title' size='small' variant='outlined') {{$t("options.content.title_page")}}
    v-btn(@click='picker_open = true' size='small' variant='outlined') {{$t("options.content.picture_story")}}
    v-btn(:disabled='has_copyright' @click='add_copyright' size='small' variant='outlined')
        | {{$t("common.copyright")}}

div.warnings(v-if='warnings' class='mt-4 text-body-medium')
    div(v-for='warning of warnings') {{ warning }}

DialogPictureStoryPicker(v-model='picker_open' @select-story='add_picture_story_from'
    @select-custom='add_picture_story')

</template>


<script lang='ts' setup>

import {reactive, computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'

import {blue, state, has_copyright, requires_copyright} from '@/services/state'
import {gen_content_name} from '@/services/blueprints'
import {generate_token} from '@/services/utils'
import {story_to_slides, story_reference_label} from '@/services/stories'
import DialogPictureStoryPicker from '@/comp/dialogs/DialogPictureStoryPicker.vue'
import AppDraggableList from '@/comp/global/AppDraggableList.vue'

import type {ContentItem, ContentTitle, ContentPictureStory} from '@/services/types'
import type {Story} from '@/services/stories'


const {t} = useI18n()


const type_label:Record<string, string> = {
    passage: t("common.passage"),
    custom: t("common.text"),
    title: t("options.content.title_page"),
    picture_story: t("options.content.picture_story"),
}


const warnings = computed(() => {
    const items:string[] = []
    if (requires_copyright.value && !has_copyright.value){
        items.push(t("options.content.copyright_required"))
    }
    // Book-like layouts always insert a leading blank when the first item needs a recto start
    if (blue.content[0]?.type === 'passage'
            && (blue.bibles.length === 2 && blue.bibles_layout === 'alternate'
                || blue.half_blank !== null)){
        items.push(t("options.content.blank_first_page"))
    }
    return items
})


const add_passage = () => {
    state.editor = {
        component: 'EditorPassage',
        props: {
            item: null,
        },
    }
}


const add_custom = () => {
    state.editor = {
        component: 'EditorCustom',
        props: {
            item: null,
        },
    }
}


const add_title = () => {
    const new_title:ContentTitle = reactive({
        id: generate_token(),
        type: 'title',
        title: '',
        title_subtitle: "",
        title_icon: null,
    })
    blue.content.push(new_title)
    state.editor = {
        component: 'EditorTitle',
        props: {
            item: new_title,
        },
    }
}


// Open the picture-story picker rather than creating one directly
const picker_open = ref(false)


// Push a new picture-story item to the content list and open it for editing
const open_picture_story_editor = (new_story:ContentPictureStory) => {
    blue.content.push(new_story)
    state.editor = {
        component: 'EditorPictureStory',
        props: {
            item: new_story,
        },
    }
}


const add_picture_story = () => {
    open_picture_story_editor(reactive({
        id: generate_token(),
        type: 'picture_story',
        title: '',
        title_subtitle: "",
        title_icon: null,
        slides: [],
    }))
}


// Pre-fill a picture story from a predefined story (still fully editable afterward)
const add_picture_story_from = (story:Story) => {
    open_picture_story_editor(reactive({
        id: generate_token(),
        type: 'picture_story',
        title: story.heading,
        title_subtitle: story_reference_label(story),
        title_icon: null,
        slides: story_to_slides(story),
    }))
}


const add_copyright = () => {
    blue.content.push(reactive({
        type: 'custom',
        id: generate_token(),
        name: "Copyright",
        doc: {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: 'AUTO-COPYRIGHT'}]},
        ]},
        position: 'middle',
    }))
}


const rm_content = (item_to_remove:ContentItem) => {
    const index = blue.content.findIndex(item => item === item_to_remove)
    if (index !== -1){
        blue.content.splice(index, 1)
    }
}

const edit = (item:ContentItem) => {

    const components:Record<string, string> = {
        passage: 'EditorPassage',
        title: 'EditorTitle',
        custom: 'EditorCustom',
        picture_story: 'EditorPictureStory',
    }

    state.editor = {
        component: components[item.type]!,
        props: {
            item,
        },
    }
}

</script>


<style lang='sass' scoped>

.handle
    cursor: move

.v-chip
    cursor: pointer
    font-weight: bold
    width: 100px
    justify-content: center

.v-list-item
    padding-inline: 0 !important

.add
    .v-btn
        margin: 6px

.warnings
    color: hsl(33, 100%, 35%)

</style>
