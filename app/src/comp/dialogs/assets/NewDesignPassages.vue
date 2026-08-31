
<template lang='pug'>

div
    p(class='mb-3 text-body-medium text-medium-emphasis') {{ hint }}
    v-textarea(v-model='passage_input' :label='$t("common.passages")' rows='4' hide-details='auto'
        variant='outlined')
    div.mode_switch
        v-btn(size='small' variant='tonal' color='primary' :disabled='!passage_input.trim()'
            @click='add_passages') {{$t("common.add")}}
        slot(name='switch')
    AppDraggableList(v-if='draft.passages.length' :list='draft.passages' :item_key='i => i.id'
            handle='.handle' class='mt-4')
        template(#item='{element}')
            div.passage_row
                v-text-field(:model-value='element.text' density='compact' hide-details
                    variant='underlined' @update:model-value='v => update_passage(element, v)')
                app-icon.status(:name='element.book ? "check" : "close"'
                    :class='element.book ? "text-success" : "text-error"')
                v-btn(icon variant='text' class='handle')
                    app-icon(name='drag_indicator')
                v-btn(icon variant='text' @click='rm_passage(element)')
                    app-icon(name='close')

</template>


<script lang='ts' setup>

import {ref} from 'vue'

import {content} from '@/services/content'
import {generate_token} from '@/services/utils'
import AppDraggableList from '@/comp/global/AppDraggableList.vue'

import type {NewDesignDraft, DraftPassage} from '@/services/new_design'


// Shared free-text passage list editor for the wizard's books/stories step, used both for the
// regular passages mode and (with a different hint) the picture-story passages mode — neither
// offers an image option, since that's always added later via the full editor
const props = defineProps<{draft:NewDesignDraft, hint:string}>()
const draft = props.draft


// The textarea for typing a batch of new passages before clicking "Add"
const passage_input = ref('')


// Parse a single line of free-text into a draft passage (book/chapter/verse fields null if the
// text isn't a recognised reference, so the tick just reflects `book !== null`)
const parse_passage = (id:string, text:string):DraftPassage => {
    const bible = content.collection.get_preferred_resource().id
    const ref = content.collection.string_to_reference(text, bible)
    return {
        id,
        text,
        book: ref?.book ?? null,
        start_chapter: ref?._args.start_chapter ?? null,
        start_verse: ref?._args.start_verse ?? null,
        end_chapter: ref?._args.end_chapter ?? null,
        end_verse: ref?._args.end_verse ?? null,
    }
}


// Parse every non-blank line of the textarea into a new draft passage, appended in order
const add_passages = () => {
    const lines = passage_input.value.split('\n').map(line => line.trim()).filter(line => line)
    for (const line of lines){
        draft.passages.push(parse_passage(generate_token(), line))
    }
    passage_input.value = ''
}


// Re-parse a passage after the user edits its text inline
const update_passage = (item:DraftPassage, text:string) => {
    Object.assign(item, parse_passage(item.id, text))
}


// Remove a passage from the custom list
const rm_passage = (item:DraftPassage) => {
    const index = draft.passages.indexOf(item)
    if (index !== -1){
        draft.passages.splice(index, 1)
    }
}

</script>


<style lang='sass' scoped>

.mode_switch
    display: flex
    align-items: center
    gap: 8px

.passage_row
    display: flex
    align-items: center
    gap: 4px

    .status
        flex: none

    .handle
        cursor: move
        flex: none

</style>
