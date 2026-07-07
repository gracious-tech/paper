
import {reactive} from 'vue'

import {BibleContent} from 'paper-bible-typst'
import {get_fonts} from 'typst-fonts'
import {load_fonts_prefix} from 'typst-fonts/web'

import type {BibleCollection, GetResourcesItem, GetLanguagesItem, GetBooksItem} from '@gracious.tech/fetch-client'
import type {BundledFont} from 'typst-fonts'


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
    // Curated font manifest for the style picker (see load_fonts() below), grouped by
    // BundledFont.group. Empty until load_fonts() resolves.
    fonts: reactive([]) as BundledFont[],
}


// Fetch the curated font manifest (see .bin/download_fonts) and populate content.fonts.
// paper-bible-typst-web independently loads the same manifest for the compiler itself — both
// share typst-fonts' module-level state, so whichever runs first wins with no ill effect.
export async function load_fonts(fonts_prefix:string):Promise<void> {
    await load_fonts_prefix(fonts_prefix)
    content.fonts.splice(0, content.fonts.length, ...get_fonts())
}
