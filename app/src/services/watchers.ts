
import {watch} from 'vue'

import {blue} from '@/services/state'
import {content, bible_content} from '@/services/content'

import type {ContentPassage} from '@/services/types'


// Start watching and responding to state changes
export function start_watchers(){

    // Auto-load book names + words-of-Jesus support for each selected translation
    watch(() => blue.bibles, async () => {
        for (const bible of blue.bibles){
            // If don't have books for bible yet, get them
            if (!content.books[bible]){
                // Immediately set before local names available
                content.books[bible]
                    = bible_content.collection.get_books(bible, {object: true, whole: true})
                // Once have fetched local names, update the list and record wj support
                const {wj_markup} = await bible_content.load_translation(bible)
                content.wj_markup[bible] = wj_markup
                content.books[bible]
                    = bible_content.collection.get_books(bible, {object: true, whole: true})
            }
        }
    }, {deep: true, immediate: true})

    // Auto-load (and cache) the Typst content for every passage's book, recording readiness in
    // the reactive `loaded` mirror so the preview re-renders as each book arrives
    // WARN Watch sources must be functions so still reactive when blueprint completely replaced
    watch([() => blue.bibles, () => blue.content], () => {

        const content_books = [...new Set(blue.content.filter(item => item.type === 'passage')
            .map(item => (item as ContentPassage).book))]

        for (const bible of blue.bibles){
            for (const book of content_books){
                const key = `${bible}_${book}`
                if (content.loaded[key]){
                    continue
                }
                // Fetch the Typst format, used by the in-browser PDF preview and generation
                void bible_content.fetch_book(bible, book).then(instance => {
                    if (instance){
                        content.loaded[key] = true
                    }
                })
            }
        }
    }, {deep: true, immediate: true})
}
