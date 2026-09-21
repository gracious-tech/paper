
// Test double for the Bible content service (see vitest.config.ts for why it's aliased rather
// than mocked per file).
//
// The real module owns a live fetch-client and a collection that stays null until the app boots,
// so anything calling into it would either hit the network or dereference null. What the services
// under test actually use is a handful of collection methods, stubbed here to echo their inputs
// back — so a test can assert *which* bible and whether abbreviation was asked for, rather than
// re-testing fetch-client's own reference formatting.

import type {GetBooksItem, GetResourcesItem} from '@gracious.tech/fetch-client'


// A passage reference, as PassageReference exposes the fields these stubs read
interface StubReference {
    book:string
    start_chapter?:number|null
    end_chapter?:number|null
}


// What reference_to_string() returns: "<bible>:<book>" plus "!" when abbreviated, and the
// chapter range when there is one. Deliberately not a real reference string
function format_reference(reference:StubReference, bible:string, abbreviate?:boolean):string{
    const range = reference.start_chapter
        ? ` ${reference.start_chapter}${
            reference.end_chapter && reference.end_chapter !== reference.start_chapter
                ? `-${reference.end_chapter}` : ''}`
        : ''
    return `${bible}:${reference.book}${range}${abbreviate ? '!' : ''}`
}


export const endpoint = 'http://localhost:8430/'


export const bible_content = {
    // Nothing under test drives a compile, so this only has to exist
}


export const content = {
    collection: {
        get_preferred_resource: () => ({id: 'eng_bsb'}) as GetResourcesItem,
        reference_to_string: format_reference,
    },
    languages: {} as Record<string, unknown>,
    translations: {} as Record<string, Partial<GetResourcesItem>>,
    books: {} as Record<string, Record<string, Partial<GetBooksItem>>>,
    wj_markup: {} as Record<string, boolean>,
    loaded: {} as Record<string, boolean>,
    fonts: [] as unknown[],
    example_text: {title: '', heading: '', verse: ''},
}


export function reset_content():void{
    // Put the double back to a bare state between tests
    content.translations = {}
    content.books = {}
    content.languages = {}
    content.wj_markup = {}
    content.loaded = {}
    content.collection.get_preferred_resource = () => ({id: 'eng_bsb'}) as GetResourcesItem
    content.collection.reference_to_string = format_reference
}


export function set_translations(ids:string[]):void{
    // Make the given translation ids exist, as the app's own loader would
    content.translations = Object.fromEntries(ids.map(id => [id, {
        id, language: id.slice(0, 3), name_local: `${id} local`, name_english: `${id} english`,
    }]))
}


export function set_books(bible:string,
        books:Record<string, {available:boolean, ot?:boolean, nt?:boolean, name?:string}>):void{
    // Declare which books a translation has, for the missing-book warnings
    content.books[bible] = Object.fromEntries(Object.entries(books).map(([id, book]) => [id, {
        id, available: book.available, ot: book.ot ?? false, nt: book.nt ?? false,
        name: book.name ?? id,
    }]))
}


// Unused by the suites but exported by the real module, so imports of it still resolve
export async function load_fonts():Promise<void>{}
export async function load_translations():Promise<void>{}
