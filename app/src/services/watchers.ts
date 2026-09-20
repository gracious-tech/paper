
import {watch} from 'vue'

import {blue, estimated_pages} from '@/services/state'
import {content, bible_content, resolve_passage_examples, ensure_bible_books_loaded}
    from '@/services/content'
import {auto_binding} from '@/services/binding_advice'
import {design_wizard} from '@/services/designs'
import {apply_name_to_cover} from '@/services/cover'

import type {ContentPassage, ContentTitle} from '@/services/types'


// Start watching and responding to state changes
export function start_watchers(){

    // Auto-load book names + words-of-Jesus support for each selected translation
    watch(() => blue.bibles, async () => {
        for (const bible of blue.bibles){
            await ensure_bible_books_loaded(bible)
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

    // Carry the design's name through to the cover's printed title, for as long as the user
    // hasn't set that title themselves. Covers every way the name can change (the editor field,
    // renaming the open design from the list) in one place
    watch(() => blue.name, () => {
        apply_name_to_cover(blue)
    })

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

    // Keep a simple-mode design's binding suited to how long the document actually turns out to
    // be. Simple mode never offers the binding as a choice, so it has to be right without the
    // user's help — and it can only be known once the document has been laid out, so it's
    // re-derived from every fresh page estimate (exact for anything short enough to preview
    // whole, which is the full range where the choice is in any doubt). The full editor is left
    // alone: there the user owns the setting, with binding_page_issue() warning if it doesn't
    // suit. A binding change shifts the auto gutter and so the page count, feeding back in here —
    // but only above 100 pages for Lulu (the only service simple mode offers), by which point
    // saddle stitch is long out of range and the remaining coil/perfect choice doesn't depend on
    // the count at all, so the derivation settles rather than oscillating
    watch([() => estimated_pages.value, () => design_wizard.simple_mode, () => blue.service_id,
            () => blue.half_blank], () => {
        // Only once this design's own preview has produced an estimate — with the length unknown
        // auto_binding() assumes a full-length book, which would flip a correctly-bound short
        // design on every app load (and mark it as having unrendered changes)
        if (!design_wizard.simple_mode || estimated_pages.value === null){
            return
        }
        const binding = auto_binding(blue, estimated_pages.value)
        if (binding !== blue.binding_type){
            blue.binding_type = binding
        }
    }, {immediate: true})
}
