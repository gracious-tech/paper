
import {reactive} from 'vue'

import {BibleContent} from 'paper-bible-typst'

import type {BibleCollection, GetResourcesItem, GetLanguagesItem, GetBooksItem} from '@gracious.tech/fetch-client'


const endpoint = import.meta.env.PROD ? 'https://v1.fetch.bible/' : 'http://localhost:8430/'


// Single shared Bible-content layer: owns the fetch-client, collection, and Typst book cache,
// and resolves the draft blueprint into a TypstRequest. The same instance backs both the UI
// (which reads `.collection`) and the renderer. Title-page patterns are bundled in the typst
// package, so none need to be injected here.
export const bible_content = new BibleContent({endpoint})


// Reactive mirror of the data the UI renders from. The collection itself isn't reactive (set
// once at init); the rest is populated as translations/books load so the UI updates.
export const content = {
    // Set once at init (a reference to bible_content.collection)
    collection: null as unknown as BibleCollection,
    languages: null as unknown as Record<string, GetLanguagesItem>,
    translations: null as unknown as Record<string, GetResourcesItem>,
    // Per-bible book metadata, filled as translations load
    books: reactive({}) as Record<string, Record<string, GetBooksItem>>,
    // Whether each translation supports words-of-Jesus markup (red letters), keyed by resource id
    wj_markup: reactive({}) as Record<string, boolean>,
    // Which Typst books are cached and ready, keyed `${bible}_${book}` — drives preview refresh
    loaded: reactive({}) as Record<string, boolean>,
}
