
<template lang='pug'>

div
    template(v-if='draft.book_mode === "books"')
        p(class='mb-3 text-body-medium text-medium-emphasis')
            | {{ $t("What books of the Bible do you want included? It can be as little as one passage or as large as the whole Bible.") }}
        div.mode_switch
            v-btn(size='small' variant='text' @click='draft.book_mode = "passages"')
                | {{ $t("Specify exact passages instead") }}
        div.testaments
            section(v-for='group of groups' :key='group.label')
                div.head
                    strong {{ group.label }}
                    div.bulk
                        v-btn(size='small' variant='tonal' color='primary'
                            @click='select_all(group)') {{$t("All")}}
                        v-btn(size='small' variant='tonal' color='primary'
                            @click='select_none(group)') {{$t("None")}}
                v-list(density='compact' bg-color='transparent')
                    v-list-item(v-for='book of group.books' :key='book.id' density='compact'
                            :active='draft.books.includes(book.id)' color='primary'
                            @click='toggle(book.id)')
                        v-list-item-title {{ book.name }}
                        template(#append)
                            app-icon(v-if='draft.books.includes(book.id)' name='check')

    template(v-else)
        p(class='mb-3 text-body-medium text-medium-emphasis')
            | {{ $t("List the passages you want, one per line, e.g. \"Genesis 1:1-5\" or \"Matthew 5\", then click Add.") }}
        v-textarea(v-model='passage_input' :label='$t("Passages")' rows='4' hide-details='auto'
            variant='outlined')
        div.mode_switch
            v-btn(size='small' variant='tonal' color='primary' :disabled='!passage_input.trim()'
                @click='add_passages') {{$t("Add")}}
            v-btn(size='small' variant='text' @click='draft.book_mode = "books"')
                | {{ $t("Choose books instead") }}
        Draggable(v-if='draft.passages.length' v-model='draft.passages' handle='.handle'
                item-key='id' class='mt-4')
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

import {ref, computed} from 'vue'
import {useI18n} from 'vue-i18n'
import Draggable from 'vuedraggable'

import {content} from '@/services/content'
import {generate_token} from '@/services/utils'

import type {GetBooksItem} from '@gracious.tech/fetch-client'
import type {NewDesignDraft, DraftPassage} from '@/services/new_design'


// Wizard step 2: pick which Bible books to include, either whole books (testament columns with
// select-all shortcuts) or a custom free-text list of specific passages. Book/passage names come
// from the user's preferred translation since actual translations aren't chosen until the next
// step. Only one of `draft.books`/`draft.passages` is used at build time (see `book_mode`), but
// both are kept so toggling between the two modes never loses what was already entered
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// All books (including any the preferred translation lacks — availability depends on the
// translations chosen next, and the editor already warns about mismatches)
const books = content.collection.get_books(
    content.collection.get_preferred_resource().id, {whole: true})


// The two testament columns
const groups = computed(() => [
    {label: t("Old Testament"), books: books.filter(book => book.ot)},
    {label: t("New Testament"), books: books.filter(book => book.nt)},
])


// Toggle a single book in/out of the selection
const toggle = (id:string) => {
    const index = draft.books.indexOf(id)
    if (index === -1){
        draft.books.push(id)
    } else {
        draft.books.splice(index, 1)
    }
}


// Select every book of a testament (keeping any existing selections from the other)
const select_all = (group:{books:GetBooksItem[]}) => {
    for (const book of group.books){
        if (!draft.books.includes(book.id)){
            draft.books.push(book.id)
        }
    }
}


// Deselect every book of a testament
const select_none = (group:{books:GetBooksItem[]}) => {
    const ids = new Set(group.books.map(book => book.id))
    draft.books.splice(0, draft.books.length, ...draft.books.filter(id => !ids.has(id)))
}


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

.testaments
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 16px
    align-items: start

    .head
        display: flex
        flex-direction: column
        margin-bottom: 8px

        .bulk
            display: flex
            gap: 4px

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
