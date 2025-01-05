
import {watch} from 'vue'

import {blue, creations, selected_creation} from '@/services/state'
import {database} from '@/services/db'
import {content} from '@/services/content'
import {gen_creation_url} from '@/services/backend'

import type {ContentPassage} from '@/services/types'


// Start watching and responding to state changes
export function start_watchers(){

    // Auto-save draft whenever it changes
    watch(blue, () => {
        database.config_set('draft', blue)
    })

    // Auto-load book names
    watch(() => blue.bibles, async () => {
        for (const bible of blue.bibles){
            // If don't have books for bible yet, get them
            if (!content.books[bible]){
                // Immediately set before local names available
                content.books[bible]
                    = content.collection.get_books(bible, {object: true, whole: true})
                // Once have fetched local names, update the list
                content.collection.fetch_translation_extras(bible).then(() => {
                    content.books[bible]
                        = content.collection.get_books(bible, {object: true, whole: true})
                })
            }
        }
    }, {deep: true, immediate: true})

    // Auto-load Bible books
    // WARN Watch sources must be functions so still reactive when blueprint completely replaced
    watch([() => blue.bibles, () => blue.content], async () => {

        const content_books = [...new Set(blue.content.filter(item => item.type === 'passage')
            .map(item => (item as ContentPassage).book))]

        for (const bible of blue.bibles){
            for (const book of content_books){
                const key = `${bible}_${book}`
                // WARN Call get_books() manually in case content.books not populated yet
                const books_for_bible = content.collection.get_books(bible, {object: true})
                if (!(key in content.books_html) && books_for_bible[book]?.available){
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

    // Auto-detect if a creation has expired whenever a user tries to access it
    watch(selected_creation, async (creation) => {
        if (creation?.status === 'available'){
            const url = gen_creation_url(creation.creation_id!, 'pdf')
            let resp:Response
            try {
                resp = await fetch(url, {method: 'HEAD'})
            } catch {
                return  // Ignore network failure
            }
            if (resp.status === 403 || resp.status === 404){
                // Creation has expired

                // Ensure creation hasn't been deleted while waiting for network
                if (creations.find(c => c.request_id === creation.request_id)){
                    creation.status = 'expired'
                    database.creations_set(creation)
                }
            }
        }
    })
}
