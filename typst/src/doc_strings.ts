
// The few strings this package prints into a document itself — the copyright page and the
// "Chapter N" heading — in the language of the document's primary Bible translation, since that
// is the language the book is in, whatever language its creator uses the app in. Catalogs live in
// typst/locales/ and are compiled into generated/doc_strings.ts by the app's i18n tooling.

import {DOC_SOURCE, DOC_TRANSLATIONS} from './generated/doc_strings.js'

import type {GetResourcesItem} from '@gracious.tech/fetch-client'
import type {Blueprint} from './types.js'


// A document string's key
export type DocKey = keyof typeof DOC_SOURCE

// Looks up a document string, substituting {named} placeholders
export type DocTranslate = (key:DocKey, params?:Record<string, string|number>) => string


// A translator for one document language (a fetch.bible language code, e.g. "vie"), English for
// a language — or a key — with no translation yet
export function doc_translator(language:string|undefined):DocTranslate {
    const catalog = (language && DOC_TRANSLATIONS[language]) || {}
    return (key, params) => {
        const message:string = catalog[key] ?? DOC_SOURCE[key]
        return message.replace(/\{(\w+)\}/g, (whole, name:string) => {
            return params && name in params ? String(params[name]) : whole
        })
    }
}


// The language a document prints its own wording in: its primary translation's
export function doc_language(blue:Pick<Blueprint, 'bibles'>,
        resources:Record<string, GetResourcesItem>):string|undefined {
    const primary = blue.bibles[0]
    return primary ? resources[primary]?.language : undefined
}
