
// Browser tags in, the best supported UI locale out.
//
// UI locales are browser language tags themselves, but a browser rarely asks for exactly the tag
// a catalog is filed under ("pt-PT" for "pt-BR", "zh-TW" for "zh-Hant") — so this matching is
// what decides whether someone gets their own language.

import {describe, it, expect, afterEach, vi} from 'vitest'

import {best_locale, country_namer, detect_locale, intl_tag} from '@/services/locale'


afterEach(() => {
    vi.unstubAllGlobals()
})


// Pretend the browser prefers these languages, in order
function set_browser_languages(languages:string[]):void{
    vi.stubGlobal('navigator', {languages, language: languages[0] ?? 'en'})
}


describe('best_locale', () => {

    it('skips a supported entry that isn\'t a valid tag', () => {
        expect(best_locale('fr', ['not a tag!', 'fr-CA'])).toBe('fr-CA')
    })

    const supported = ['en', 'vi', 'pt-BR', 'zh-Hans', 'zh-Hant', 'sr-Latn']

    it('takes an exact match', () => {
        expect(best_locale('vi', supported)).toBe('vi')
        expect(best_locale('pt-BR', supported)).toBe('pt-BR')
    })

    it('serves a region from the same language', () => {
        expect(best_locale('en-US', supported)).toBe('en')
        expect(best_locale('vi-VN', supported)).toBe('vi')
        expect(best_locale('pt-PT', supported)).toBe('pt-BR')
        expect(best_locale('pt', supported)).toBe('pt-BR')
    })

    it('is case-insensitive', () => {
        expect(best_locale('EN-us', supported)).toBe('en')
        expect(best_locale('zh-hant', supported)).toBe('zh-Hant')
    })

    it('tells the Chinese scripts apart, by region as well as by script', () => {
        expect(best_locale('zh-TW', supported)).toBe('zh-Hant')
        expect(best_locale('zh-HK', supported)).toBe('zh-Hant')
        expect(best_locale('zh-Hant-TW', supported)).toBe('zh-Hant')
        expect(best_locale('zh-CN', supported)).toBe('zh-Hans')
        expect(best_locale('zh', supported)).toBe('zh-Hans')
    })

    it('never serves one script for another', () => {
        // A Traditional reader is better served by their next browser preference than by
        // Simplified, and Cyrillic Serbian is a different catalog from Latin
        expect(best_locale('zh-TW', ['en', 'zh-Hans'])).toBe(null)
        expect(best_locale('sr', supported)).toBe(null)
        expect(best_locale('sr-Latn-RS', supported)).toBe('sr-Latn')
    })

    it('understands a legacy ISO 639-3 code', () => {
        // A language picked by hand was saved under these before the UI moved to browser tags
        expect(best_locale('vie', supported)).toBe('vi')
        expect(best_locale('eng', supported)).toBe('en')
    })

    it('returns null for something it cannot use', () => {
        expect(best_locale('', supported)).toBe(null)
        expect(best_locale('fr', supported)).toBe(null)
        expect(best_locale('not a tag', supported)).toBe(null)
    })
})


describe('detect_locale', () => {

    it('picks the first supported language the browser asks for', () => {
        set_browser_languages(['fr-FR', 'vi', 'en'])
        expect(detect_locale(['vi'])).toBe('vi')
    })

    it('always accepts the fallback, supported or not', () => {
        set_browser_languages(['en-GB'])
        expect(detect_locale([])).toBe('en')
    })

    it('falls back when nothing matches', () => {
        set_browser_languages(['fr-FR', 'de'])
        expect(detect_locale(['vi'])).toBe('en')
    })

    it('honours an explicit fallback', () => {
        set_browser_languages(['fr'])
        expect(detect_locale(['vi'], 'vi')).toBe('vi')
    })

    it('uses navigator.language when there is no list', () => {
        vi.stubGlobal('navigator', {languages: [], language: 'vi-VN'})
        expect(detect_locale(['vi'])).toBe('vi')
    })

    it('matches a regional tag to its language', () => {
        set_browser_languages(['pt-PT', 'en'])
        expect(detect_locale(['pt-BR', 'vi'])).toBe('pt-BR')
    })

    it('skips an unmappable tag rather than giving up', () => {
        set_browser_languages(['xx-YY', 'vi'])
        expect(detect_locale(['vi'])).toBe('vi')
    })
})


describe('country_namer', () => {

    it('names a country in the requested language', () => {
        expect(country_namer('en')('au')).toBe('Australia')
    })

    it('accepts a lowercase code', () => {
        expect(country_namer('en')('gb')).toBe(country_namer('en')('GB'))
    })

    it('never returns nothing for an unknown code', () => {
        // Intl answers "Unknown Region" for a reserved code rather than undefined; the code
        // itself is the last resort behind that
        const name = country_namer('en')('zz')
        expect(typeof name).toBe('string')
        expect(name.length).toBeGreaterThan(0)
    })

    it('falls back to the code itself for a locale Intl can\'t parse', () => {
        expect(country_namer('not a tag!')('au')).toBe('AU')
    })

    it('still returns a usable namer for a locale Intl has never heard of', () => {
        const name = country_namer('xyz')
        expect(typeof name('au')).toBe('string')
        expect(name('au').length).toBeGreaterThan(0)
    })
})


describe('intl_tag', () => {

    it('keeps the browser\'s regional tag for the same language', () => {
        set_browser_languages(['en-GB', 'vi'])
        expect(intl_tag('en')).toBe('en-GB')
    })

    it('falls back to the locale itself when the browser doesn\'t ask for that language', () => {
        set_browser_languages(['fr-FR'])
        expect(intl_tag('vi')).toBe('vi')
    })
})
