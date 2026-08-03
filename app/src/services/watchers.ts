
import {watch} from 'vue'

import {blue} from '@/services/state'
import {content, bible_content, resolve_passage_examples} from '@/services/content'

import type {ContentPassage, ContentTitle} from '@/services/types'


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

    // Auto-load (and cache) each passage's book content, recording readiness in the reactive
    // `loaded` mirror so the preview re-renders as each book arrives. Regular passages render the
    // marked-up Typst format; picture stories render clean plain text (from the primary
    // translation only) — preload each in the format it will actually be compiled from.
    // WARN Watch sources must be functions so still reactive when blueprint completely replaced
    watch([() => blue.bibles, () => blue.content], () => {

        // Distinct books needed in each format
        const typst_books = new Set<string>()
        const txt_books = new Set<string>()
        for (const item of blue.content){
            if (item.type === 'passage'){
                typst_books.add(item.book)
            } else if (item.type === 'picture_story'){
                for (const slide of item.slides){
                    if (slide.mode === 'passage' && slide.book){
                        txt_books.add(slide.book)
                    }
                }
            }
        }

        // Marked-up Typst for regular passages, across every selected translation
        for (const bible of blue.bibles){
            for (const book of typst_books){
                const key = `${bible}_${book}`
                if (content.loaded[key]){
                    continue
                }
                void bible_content.fetch_book(bible, book).then(instance => {
                    if (instance){
                        content.loaded[key] = true
                    }
                })
            }
        }

        // Plain text for picture stories, primary translation only (~txt key so it never clashes
        // with the same book's Typst readiness flag)
        const primary = blue.bibles[0]
        for (const book of txt_books){
            const key = `${primary}_${book}~txt`
            if (content.loaded[key]){
                continue
            }
            void bible_content.fetch_book_txt(primary, book).then(instance => {
                if (instance){
                    content.loaded[key] = true
                }
            })
        }
    }, {deep: true, immediate: true})

    // Auto-refresh the font pickers' example text (title/heading/verse) as content or the
    // selected translations change
    watch([() => blue.content, () => blue.bibles], async () => {
        const title_item = blue.content.find(item => item.type === 'title') as
            ContentTitle|undefined
        content.example_text.title = title_item?.title.trim() ?? ''

        const passage_item = blue.content.find(item => item.type === 'passage') as
            ContentPassage|undefined
        if (!passage_item || !blue.bibles.length){
            content.example_text.heading = ''
            content.example_text.verse = ''
            return
        }
        const {heading, verse} = await resolve_passage_examples(passage_item, blue.bibles)
        content.example_text.heading = heading
        content.example_text.verse = verse
    }, {deep: true, immediate: true})
}
