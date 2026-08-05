
import {reactive} from 'vue'

import {PassageReference} from '@gracious.tech/fetch-client'
import {BibleContent} from 'paper-bible-typst'
import {get_fonts} from 'typst-fonts'
import {load_fonts_prefix, register_preview_fonts} from 'typst-fonts/web'

import type {BibleCollection, GetResourcesItem, GetLanguagesItem, GetBooksItem} from '@gracious.tech/fetch-client'
import type {BundledFont} from 'typst-fonts'
import type {ContentPassage} from './types'


export const endpoint = import.meta.env.PROD ? 'https://v1.fetch.bible/' : 'http://localhost:8430/'


// Single shared Bible-content layer: owns the fetch-client, collection, and Typst book cache,
// and resolves the open design's blueprint into a TypstRequest. The same instance backs both the UI
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
    // Example text for the font pickers (title/heading/verse), kept in sync with the current
    // content by a watcher in watchers.ts. Empty string means "nothing available yet" — the
    // picker falls back to a default sentence.
    example_text: reactive({title: '', heading: '', verse: ''}),
}


// Fetch the curated font manifest (from the bookcover repo's assets tree) and populate content.fonts.
// paper-bible-typst-web independently loads the same manifest for the compiler itself — both
// share typst-fonts' module-level state, so whichever runs first wins with no ill effect.
export async function load_fonts(fonts_prefix:string):Promise<void> {
    await load_fonts_prefix(fonts_prefix)
    const fonts = get_fonts()
    content.fonts.splice(0, content.fonts.length, ...fonts)
    // Register real font files so CSS previews (e.g. the font pickers) can render actual glyphs
    register_preview_fonts(fonts_prefix, fonts)
}


// Ensure a translation's book metadata (names/availability, words-of-Jesus support) is loaded
// into `content.books`/`content.wj_markup` — shared by the auto-load watcher (for the open
// design's `blue.bibles`) and the new-design wizard (whose `draft.bibles` isn't watched there)
export async function ensure_bible_books_loaded(bible:string):Promise<void> {
    if (content.books[bible]){
        return
    }
    // Immediately set before local names available
    content.books[bible] = bible_content.collection.get_books(bible, {object: true, whole: true})
    // Once have fetched local names, update the list and record wj support
    const {wj_markup} = await bible_content.load_translation(bible)
    content.wj_markup[bible] = wj_markup
    content.books[bible] = bible_content.collection.get_books(bible, {object: true, whole: true})
}


// Roughly strip Typst markup down to plain text — used only for font-picker example text, where
// an exact result doesn't matter, just something readable in the chosen font
function typst_to_plain(markup:string):string {
    return markup
        .replace(/^=+\s.*$/gm, '')  // drop heading lines (extracted separately)
        .replace(/#[a-zA-Z_][\w.]*(\([^)]*\))?\[/g, '')  // function calls opening a body: keep body
        .replace(/[[\]]/g, '')  // any leftover brackets
        .replace(/#[a-zA-Z_][\w.]*(\([^)]*\))?/g, '')  // bodyless function calls
        .replace(/\s+/g, ' ')
        .trim()
}


// Best-effort extraction of a heading + a verse snippet from a passage's Typst markup, for the
// font pickers' example text — approximate is fine, this never reaches the actual PDF
function extract_examples(markup:string):{heading:string, verse:string} {
    const heading_match = /^=+\s+(.+)$/m.exec(markup)
    const heading = heading_match ? typst_to_plain(heading_match[1]!) : ''
    const verse = typst_to_plain(markup).split(/(?<=[.!?])\s/)[0] ?? ''
    return {heading, verse}
}


// Resolve the example heading/verse text for a passage, trying each selected bible in turn until
// one yields content (some translations may not have the book)
export async function resolve_passage_examples(
    passage:ContentPassage, bibles:string[],
):Promise<{heading:string, verse:string}> {
    for (const bible of bibles) {
        const instance = await bible_content.fetch_book(bible, passage.book)
        if (!instance) {
            continue
        }
        const markup = instance.get_passage_from_ref(new PassageReference(passage), {attribute: false})
        const examples = extract_examples(markup)
        if (examples.heading || examples.verse) {
            return examples
        }
    }
    return {heading: '', verse: ''}
}
