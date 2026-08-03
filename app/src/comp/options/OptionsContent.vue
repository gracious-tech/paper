
<template lang='pug'>

v-list(bg-color='transparent')
    Draggable(v-model='blue.content' handle='.handle' item-key='id')
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
    strong(class='text-medium-emphasis mr-2') {{$t("Add")}}
    v-btn(@click='add_passage' size='small' variant='outlined') {{$t("Passage")}}
    v-btn(@click='add_custom' size='small' variant='outlined') {{$t("Text")}}
    v-btn(@click='add_title' size='small' variant='outlined') {{$t("Title page")}}
    v-btn(@click='add_picture_story' size='small' variant='outlined') {{$t("Picture story")}}
    v-btn(:disabled='has_copyright' @click='add_copyright' size='small' variant='outlined')
        | {{$t("Copyright")}}

div.warnings(v-if='warnings' class='mt-4 text-body-medium')
    div(v-for='warning of warnings') {{ warning }}

</template>


<script lang='ts' setup>

import {reactive, computed} from 'vue'
import {useI18n} from 'vue-i18n'
import Draggable from 'vuedraggable'

import {blue, state, has_copyright, requires_copyright} from '@/services/state'
import {gen_content_name} from '@/services/blueprints'
import {generate_token} from '@/services/utils'

import type {ContentItem, ContentTitle, ContentPictureStory} from '@/services/types'


const {t} = useI18n()


const type_label:Record<string, string> = {
    passage: t("Passage"),
    custom: t("Text"),
    title: t("Title page"),
    picture_story: t("Picture story"),
}


const warnings = computed(() => {
    const items:string[] = []
    if (requires_copyright.value && !has_copyright.value){
        items.push(t("A copyright statement is required for one or more translations"))
    }
    // Book-like layouts always insert a leading blank when the first item needs a recto start
    if (blue.content[0]?.type === 'passage'
            && (blue.bibles.length === 2 && blue.bibles_layout === 'alternate'
                || blue.half_blank !== null)){
        items.push(t("Document will start with a blank page (due to layout settings)"))
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


const add_picture_story = () => {
    const new_story:ContentPictureStory = reactive({
        id: generate_token(),
        type: 'picture_story',
        name: '',
        title: '',
        title_subtitle: "",
        title_icon: null,
        slides: [],
    })
    blue.content.push(new_story)
    state.editor = {
        component: 'EditorPictureStory',
        props: {
            item: new_story,
        },
    }
}


const add_copyright = () => {
    blue.content.push(reactive({
        type: 'custom',
        id: generate_token(),
        name: "Copyright",
        doc: {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: 'AUTO-COPYRIGHT'}]},
        ]},
        position: 'bottom',
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
