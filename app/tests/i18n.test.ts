
// The homegrown i18n module: a flat catalog lookup with {named} placeholders, an eng fallback,
// and plural handling done by picking a key rather than by message-format syntax.
//
// Deliberately library-free because the app targets 800+ machine-translated locales, where ICU
// syntax gets mangled in translation and CLDR plural data doesn't exist for most targets — so
// the rules the catalogs are held to are the ones asserted here.

import {readFileSync, readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {describe, it, expect} from 'vitest'

import {translate, count_phrase, useI18n, locale, SOURCE_LOCALE, i18n} from '@/services/i18n'

import eng from '@/locales/eng.json'


const LOCALES_DIR = fileURLToPath(new URL('../src/locales', import.meta.url))


// Every key in the source catalog
const keys = Object.keys(eng as Record<string, string>)


describe('translate', () => {

    it('returns the source string for a known key', () => {
        const key = keys[0]!
        expect(translate(key)).toBe((eng as Record<string, string>)[key])
    })

    it('returns the key itself when nothing defines it', () => {
        // Visible in the UI, which is the point — a missing key should be obvious, not blank
        expect(translate('no.such.key.exists')).toBe('no.such.key.exists')
    })

    it('substitutes a named placeholder', () => {
        expect(translate('no.such.key.{name}', {name: 'value'})).toBe('no.such.key.value')
    })

    it('substitutes the same placeholder everywhere it appears', () => {
        expect(translate('{a} and {a}', {a: 'x'})).toBe('x and x')
    })

    it('substitutes several placeholders', () => {
        expect(translate('{a}-{b}', {a: 1, b: 2})).toBe('1-2')
    })

    it('stringifies a numeric parameter', () => {
        expect(translate('{n} pages', {n: 12})).toBe('12 pages')
    })

    it('leaves an unmatched placeholder alone rather than blanking it', () => {
        // A translator who renamed a placeholder leaves evidence, instead of an empty gap
        expect(translate('{a} and {b}', {a: 'x'})).toBe('x and {b}')
    })

    it('ignores extra parameters', () => {
        expect(translate('{a}', {a: 'x', unused: 'y'})).toBe('x')
    })

    it('leaves placeholders alone when no parameters are given', () => {
        expect(translate('{a}')).toBe('{a}')
    })
})


describe('count_phrase', () => {

    it('picks the .one key for exactly one', () => {
        expect(count_phrase(translate, 'stem', 1)).toBe('stem.one')
    })

    it('picks the .other key for anything else', () => {
        for (const n of [0, 2, 17, -1]){
            expect(count_phrase(translate, 'stem', n)).toBe('stem.other')
        }
    })

    it('passes the count through as {n}', () => {
        expect(count_phrase(translate, '{n} of stem', 3)).toBe('3 of stem.other')
    })
})


describe('useI18n', () => {

    it('hands back the translator and the reactive locale', () => {
        const {t, locale: active} = useI18n()
        expect(t).toBe(translate)
        expect(active).toBe(locale)
    })

    it('starts on the source locale', () => {
        expect(locale.value).toBe(SOURCE_LOCALE)
        expect(SOURCE_LOCALE).toBe('eng')
    })
})


describe('the vue plugin', () => {

    it('exposes $t on templates', () => {
        const app = {config: {globalProperties: {} as Record<string, unknown>}}
        i18n.install(app as never)
        expect(app.config.globalProperties['$t']).toBe(translate)
    })
})


describe('the catalogs themselves', () => {

    // Held to the same shape the tooling in app/i18n/ enforces, so a hand-edited catalog can't
    // quietly break the contract these messages are written under

    it('has a non-empty source catalog', () => {
        expect(keys.length).toBeGreaterThan(0)
    })

    it('has only string values in the source catalog', () => {
        const non_strings = Object.entries(eng as Record<string, unknown>)
            .filter(([, value]) => typeof value !== 'string')
        expect(non_strings).toEqual([])
    })

    it('uses no ICU plural or select syntax', () => {
        // Machine translation mangles it, and there is no formatter here to read it anyway
        const icu = Object.entries(eng as Record<string, string>)
            .filter(([, message]) => /\{\s*\w+\s*,\s*(plural|select|selectordinal)/.test(message))
        expect(icu).toEqual([])
    })

    it('uses only simple {named} placeholders', () => {
        const bad = Object.entries(eng as Record<string, string>)
            .flatMap(([key, message]) =>
                [...message.matchAll(/\{([^}]*)\}/g)]
                    .filter(match => !/^\w+$/.test(match[1]!))
                    .map(match => `${key}: {${match[1]}}`))
        expect(bad).toEqual([])
    })

    it('pairs every count phrase\'s .one key with a .other key', () => {
        // count_phrase() picks one or the other by the count, so a missing sibling renders the
        // raw key to the user. Scoped to messages carrying {n}, since a bare ".one" key can
        // legitimately be the word "One" rather than a plural stem
        const unpaired = keys
            .filter(key => key.endsWith('.one')
                && (eng as Record<string, string>)[key]!.includes('{n}'))
            .filter(key => !keys.includes(`${key.slice(0, -4)}.other`))
        expect(unpaired).toEqual([])
    })

    it('pairs every count phrase\'s .other key with a .one key', () => {
        const unpaired = keys
            .filter(key => key.endsWith('.other'))
            .filter(key => !keys.includes(`${key.slice(0, -6)}.one`))
        expect(unpaired).toEqual([])
    })

    describe('translated catalogs', () => {

        // Every locale file beside eng.json, checked for placeholder parity — a translation
        // that dropped or renamed a placeholder renders a literal brace to the user
        const others = readdirSync(LOCALES_DIR)
            .filter(name => name.endsWith('.json') && name !== 'eng.json')

        const placeholders = (message:string):string[] =>
            [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()

        for (const name of others){
            it(`${name} keeps every source placeholder`, () => {
                const catalog = JSON.parse(
                    readFileSync(`${LOCALES_DIR}/${name}`, 'utf8')) as Record<string, string>
                const mismatched = Object.entries(catalog)
                    .filter(([key, message]) => {
                        const source = (eng as Record<string, string>)[key]
                        return source !== undefined
                            && placeholders(source).join() !== placeholders(message).join()
                    })
                    .map(([key]) => key)
                expect(mismatched).toEqual([])
            })

            it(`${name} defines no key the source does not`, () => {
                const catalog = JSON.parse(
                    readFileSync(`${LOCALES_DIR}/${name}`, 'utf8')) as Record<string, string>
                const orphans = Object.keys(catalog).filter(key => !(key in eng))
                expect(orphans).toEqual([])
            })
        }
    })
})
