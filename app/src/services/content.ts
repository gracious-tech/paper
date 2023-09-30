
import {reactive} from 'vue'

import {BibleClient} from '@gracious.tech/fetch-client'

import type {BibleCollection, GetTranslationsItem, GetLanguagesItem,
    } from '@gracious.tech/fetch-client/dist/esm/collection'
import type {BibleBookHtml} from '@gracious.tech/fetch-client/dist/esm/book'


const endpoint = import.meta.env.PROD ? 'https://collection.fetch.bible/' : 'http://localhost:8430/'


export const content = {
    client: new BibleClient({endpoints: [endpoint]}),
    // These will be set before app loads, so force types
    collection: null as unknown as BibleCollection,
    languages: null as unknown as Record<string, GetLanguagesItem>,
    translations: null as unknown as Record<string, GetTranslationsItem>,
    books_html: reactive({}) as Record<string, BibleBookHtml>,
    notes: reactive({}) as Record<string, Record<string, string>>,
}
