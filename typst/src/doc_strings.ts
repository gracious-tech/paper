
// The few strings this package prints into a document itself — the copyright page and the
// "Chapter N" heading — in the language of the document's primary Bible translation, since that
// is the language the book is in, whatever language its creator uses the app in (passing over a
// classical language, see doc_language()). Catalogs live in
// typst/locales/ and are compiled into generated/doc_strings.ts by the app's i18n tooling.

import {DOC_SOURCE, DOC_TRANSLATIONS} from './generated/doc_strings.js'

import type {GetResourcesItem} from '@gracious.tech/fetch-client'
import type {Blueprint} from './types.js'


// A document string's key
export type DocKey = keyof typeof DOC_SOURCE

// Looks up a document string, substituting {named} placeholders
export type DocTranslate = (key:DocKey, params?:Record<string, string|number>) => string


// A translator for one document language (a fetch.bible language code, e.g. "vie", with its
// script when the translation declares one, e.g. "cmn-Hant"). A script-qualified code falls back
// to the bare language's catalog, so a language written in more than one script must key its
// catalogs by script instead. English for a language — or a key — with no translation yet
export function doc_translator(language:string|undefined):DocTranslate {
    const bare = language?.split('-')[0]
    const catalog = (language && DOC_TRANSLATIONS[language])
        || (bare && DOC_TRANSLATIONS[bare]) || {}
    return (key, params) => {
        const message:string = catalog[key] ?? DOC_SOURCE[key]
        return message.replace(/\{(\w+)\}/g, (whole, name:string) => {
            return params && name in params ? String(params[name]) : whole
        })
    }
}


// Classical languages a Bible is read in for study or liturgy, never as its readers' own — a
// Greek/English study edition leads with the Greek but its readers want English front matter.
// Not derivable from fetch.bible's data: its null `pop` also covers living languages (nob, ory)
const CLASSICAL_LANGUAGES = new Set(['grc', 'hbo', 'arc', 'syc', 'lat', 'cop', 'san'])


// The language a document prints its own wording in: its first translation's that isn't in a
// classical language (else simply its first's), qualified by script where fetch.bible declares
// one (e.g. "cmn-Hans"/"cmn-Hant", since Chinese Bibles come in both and one catalog can't serve
// them)
export function doc_language(blue:Pick<Blueprint, 'bibles'>,
        resources:Record<string, GetResourcesItem>):string|undefined {
    const listed = blue.bibles.map(id => resources[id]).filter(resource => resource !== undefined)
    const resource = listed.find(item => !CLASSICAL_LANGUAGES.has(item.language)) ?? listed[0]
    if (!resource){
        return undefined
    }
    return resource.script ? `${resource.language}-${resource.script}` : resource.language
}
