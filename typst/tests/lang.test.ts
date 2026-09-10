
import {describe, it, expect} from 'vitest'

import {resolve_lang} from '../src/lang.js'


describe('resolve_lang', () => {

    it('maps ISO 639-3 to the 639-1 code Typst resolves', () => {
        // Typst accepts a 3-letter code but matches no language for it, so mapping is what
        // actually earns hyphenation patterns and the right quote style
        expect(resolve_lang('eng')).toBe('en')
        expect(resolve_lang('deu')).toBe('de')
        expect(resolve_lang('rus')).toBe('ru')
        expect(resolve_lang('nob')).toBe('nb')
    })

    it('maps individual languages fetch.bible tags apart from their macrolanguage', () => {
        expect(resolve_lang('swh')).toBe('sw')
        expect(resolve_lang('cmn')).toBe('zh')
        expect(resolve_lang('zsm')).toBe('ms')
    })

    it('passes an unmapped language through rather than defaulting it to English', () => {
        // Leaves it unhyphenated, which beats hyphenating it by English rules
        expect(resolve_lang('tpi')).toBe('tpi')
        expect(resolve_lang('quz')).toBe('quz')
    })

    it('defaults to English when there is no language to resolve', () => {
        expect(resolve_lang(undefined)).toBe('en')
        expect(resolve_lang('')).toBe('en')
    })

    it('never returns a code Typst would reject', () => {
        // `lang` takes a two or three letter code and errors on anything else, which would fail
        // the whole compile over one oddly-tagged translation
        expect(resolve_lang('zh-Hans')).toBe('en')
        expect(resolve_lang('ENG')).toBe('en')
        expect(resolve_lang('e')).toBe('en')
    })

})

