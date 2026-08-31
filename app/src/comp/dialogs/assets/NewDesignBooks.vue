
<template lang='pug'>

div
    template(v-if='draft.book_mode === "books"')
        p(class='mb-3 text-body-medium text-medium-emphasis')
            | {{ $t("wizard.books.question") }}
        div.mode_switch
            v-btn(size='small' variant='text' @click='draft.book_mode = "passages"')
                | {{ $t("common.specify_passages") }}
        div.testaments
            section(v-for='group of groups' :key='group.label')
                div.head
                    strong {{ group.label }}
                    div.bulk
                        v-btn(size='small' variant='tonal' color='primary'
                            @click='select_all(group)') {{$t("common.all")}}
                        v-btn(size='small' variant='tonal' color='primary'
                            @click='select_none(group)') {{$t("common.none")}}
                v-list(density='compact' bg-color='transparent')
                    v-list-item(v-for='book of group.books' :key='book.id' density='compact'
                            :active='draft.books.includes(book.id)' color='primary'
                            @click='toggle(book.id)')
                        v-list-item-title {{ book.name }}
                        template(#append)
                            app-icon(v-if='draft.books.includes(book.id)' name='check')

    template(v-else)
        NewDesignPassages(:draft='draft' :hint='passages_hint')
            template(#switch)
                v-btn(size='small' variant='text' @click='draft.book_mode = "books"')
                    | {{ $t("wizard.books.choose_books") }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import {content} from '@/services/content'
import NewDesignPassages from '@/comp/dialogs/assets/NewDesignPassages.vue'

import type {GetBooksItem} from '@gracious.tech/fetch-client'
import type {NewDesignDraft} from '@/services/new_design'


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
    {label: t("common.old_testament"), books: books.filter(book => book.ot)},
    {label: t("common.new_testament"), books: books.filter(book => book.nt)},
])


// Hint passed to <NewDesignPassages> for the "specify exact passages" input
const passages_hint = t('wizard.passages.hint')


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

</style>
