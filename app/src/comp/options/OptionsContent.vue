
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
    strong(class='text-medium-emphasis mr-2') Add
    v-btn(@click='add_passage' size='small' variant='outlined') Passage
    v-btn(@click='add_custom' size='small' variant='outlined') Text
    v-btn(@click='add_title' size='small' variant='outlined') Title page
    v-btn(:disabled='has_copyright' @click='add_copyright' size='small' variant='outlined')
        | Copyright

div(v-if='warnings' class='mt-4 text-error text-body-2')
    div(v-for='warning of warnings') {{ warning }}

</template>


<script lang='ts' setup>

import Draggable from 'vuedraggable'
import {reactive, computed} from 'vue'

import {blue, state, books_meta, has_copyright, requires_copyright} from '@/services/state'
import {gen_content_name} from '@/services/blueprints'

import {generate_token} from '@/services/utils'
import {passage_obj_to_str} from '@gracious.tech/fetch-client'
import {book_emoji} from '@/services/emoji'

import type {ContentItem, ContentPassage, ContentTitle} from '@/services/types'


const type_label:Record<string, string> = {
    passage: "Passage",
    custom: "Text",
    title: "Title page",
}


const warnings = computed(() => {
    const items:string[] = []
    if (requires_copyright.value && !has_copyright.value){
        items.push("A copyright statement is required for one or more translations")
    }
    if (blue.content[0]?.type === 'passage' && blue.page_arrangement === 'booklet'
            && (blue.bibles.length === 2 && blue.bibles_layout === 'alternate' || blue.half_blank)){
        items.push("Booklet will start with a blank page (due to layout settings)")
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

    const passage = blue.content.find(item => item.type === 'passage') as ContentPassage|undefined

    const new_title:ContentTitle = reactive({
        id: generate_token(),
        type: 'title',
        title: passage ? passage_obj_to_str(passage, books_meta.value[blue.bibles[0]]!) : "",
        subtitle: "",
        icon: passage ? book_emoji[passage.book]! : '✟',
        pattern: 'straight',
        color_primary: '#000000',
        color_secondary: '#00000044',
        alone: true,
    })
    if (passage){
        blue.content.unshift(new_title)
    } else {
        blue.content.push(new_title)
    }
    state.editor = {
        component: 'EditorTitle',
        props: {
            item: new_title,
        },
    }
}


const add_copyright = () => {
    blue.content.push(reactive({
        type: 'custom',
        id: generate_token(),
        name: "Copyright",
        html: '<p>AUTO-COPYRIGHT</p>',
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
    width: 90px
    justify-content: center

.add
    .v-btn
        margin: 6px

</style>
