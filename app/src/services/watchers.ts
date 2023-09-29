
import {watch} from 'vue'

import {blue, books_meta} from '@/services/state'
import {database} from '@/services/db'
import {content} from '@/services/content'

import type {ContentPassage} from '@/services/types'


// Start watching and responding to state changes
export function start_watchers(){

    // Auto-save draft whenever it changes
    watch(blue, () => {
        database.config_set('draft', blue)
    })

    // Auto-load Bible books
    watch([blue.bibles, blue.content], async () => {

        const content_books = [...new Set(blue.content.filter(item => item.type === 'passage')
            .map(item => (item as ContentPassage).book))]

        for (const bible of blue.bibles){
            for (const book of content_books){
                const key = `${bible}_${book}`
                if (!(key in content.books_html) && books_meta.value[bible]?.[book]?.available){
                    content.collection.fetch_book(bible, book).then(async instance => {
                        content.books_html[key] = instance
                    })
                    fetch(`${content.client._data_endpoint}notes/eng_tyndale/html/${book}.json`)
                        .then(async resp => {
                            content.notes[book] = (await resp.json())['verses']
                        })
                }
            }
        }
    }, {deep: true, immediate: true})
}
