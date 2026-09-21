
// Browser BCP-47 tags in, the app's ISO 639-3 locale codes out.
//
// The app keys translations by 639-3 to match the fetch.bible platform, but browsers only ever
// report BCP-47 — so this mapping is what decides whether someone gets their own language.

import {describe, it, expect, afterEach, vi} from 'vitest'

import {bcp47_to_locale, locale_to_bcp47, country_namer, detect_locale} from '@/services/locale'


afterEach(() => {
    vi.unstubAllGlobals()
})


// Pretend the browser prefers these languages, in order
function set_browser_languages(languages:string[]):void{
    vi.stubGlobal('navigator', {languages, language: languages[0] ?? 'en'})
}


describe('bcp47_to_locale', () => {

    it('maps a bare two-letter tag', () => {
        expect(bcp47_to_locale('en')).toBe('eng')
        expect(bcp47_to_locale('vi')).toBe('vie')
        expect(bcp47_to_locale('sw')).toBe('swa')
    })

    it('ignores a region subtag', () => {
        expect(bcp47_to_locale('en-US')).toBe('eng')
        expect(bcp47_to_locale('pt-BR')).toBe('por')
    })

    it('is case-insensitive', () => {
        expect(bcp47_to_locale('EN-us')).toBe('eng')
        expect(bcp47_to_locale('Vi')).toBe('vie')
    })

    it('distinguishes traditional from simplified Chinese', () => {
        // The only place a script subtag changes which catalog is wanted
        expect(bcp47_to_locale('zh-Hant')).toBe('zho-Hant')
        expect(bcp47_to_locale('zh-Hant-TW')).toBe('zho-Hant')
        expect(bcp47_to_locale('zh-Hans')).toBe('zho')
        expect(bcp47_to_locale('zh')).toBe('zho')
        expect(bcp47_to_locale('zh-CN')).toBe('zho')
    })

    it('passes an already-639-3 tag through', () => {
        // The browser won't send one, but a stored preference might
        expect(bcp47_to_locale('swh')).toBe('swh')
        expect(bcp47_to_locale('nya')).toBe('nya')
    })

    it('returns null for something it cannot map', () => {
        expect(bcp47_to_locale('')).toBe(null)
        expect(bcp47_to_locale('xx')).toBe(null)
        expect(bcp47_to_locale('abcd')).toBe(null)
    })
})


describe('locale_to_bcp47', () => {

    it('reverses the mapping for Intl', () => {
        // A 639-3 code the browser has never heard of makes Intl silently fall back to English
        expect(locale_to_bcp47('eng')).toBe('en')
        expect(locale_to_bcp47('vie')).toBe('vi')
    })

    it('keeps a script subtag', () => {
        expect(locale_to_bcp47('zho-Hant')).toBe('zh-Hant')
    })

    it('leaves a code with no two-letter equivalent alone', () => {
        expect(locale_to_bcp47('swh')).toBe('swh')
    })

    it('round-trips every two-letter mapping', () => {
        for (const tag of ['en', 'vi', 'fr', 'sw', 'zu', 'th']){
            expect(locale_to_bcp47(bcp47_to_locale(tag)!)).toBe(tag)
        }
    })
})


describe('detect_locale', () => {

    it('picks the first supported language the browser asks for', () => {
        set_browser_languages(['fr-FR', 'vi', 'en'])
        expect(detect_locale(['vie'])).toBe('vie')
    })

    it('always accepts the fallback, supported or not', () => {
        set_browser_languages(['en-GB'])
        expect(detect_locale([])).toBe('eng')
    })

    it('falls back when nothing matches', () => {
        set_browser_languages(['fr-FR', 'de'])
        expect(detect_locale(['vie'])).toBe('eng')
    })

    it('honours an explicit fallback', () => {
        set_browser_languages(['fr'])
        expect(detect_locale(['vie'], 'vie')).toBe('vie')
    })

    it('uses navigator.language when there is no list', () => {
        vi.stubGlobal('navigator', {languages: [], language: 'vi-VN'})
        expect(detect_locale(['vie'])).toBe('vie')
    })

    it('skips an unmappable tag rather than giving up', () => {
        set_browser_languages(['xx-YY', 'vi'])
        expect(detect_locale(['vie'])).toBe('vie')
    })
})


describe('country_namer', () => {

    it('names a country in the requested language', () => {
        expect(country_namer('eng')('au')).toBe('Australia')
    })

    it('accepts a lowercase code', () => {
        expect(country_namer('eng')('gb')).toBe(country_namer('eng')('GB'))
    })

    it('never returns nothing for an unknown code', () => {
        // Intl answers "Unknown Region" for a reserved code rather than undefined; the code
        // itself is the last resort behind that
        const name = country_namer('eng')('zz')
        expect(typeof name).toBe('string')
        expect(name.length).toBeGreaterThan(0)
    })

    it('still returns a usable namer for a locale Intl has never heard of', () => {
        const name = country_namer('xyz')
        expect(typeof name('au')).toBe('string')
        expect(name('au').length).toBeGreaterThan(0)
    })
})
