
import {describe, it, expect} from 'vitest'

import {resolve_lang, gen_locale_args, detect_dir, gen_detected_dir_arg} from '../src/lang.js'


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
        expect(resolve_lang('hbo')).toBe('he')
        expect(resolve_lang('arb')).toBe('ar')
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


describe('gen_locale_args', () => {

    it('inherits the document locale when neither differs', () => {
        expect(gen_locale_args(null, null)).toBe('')
    })

    it('passes language and direction independently', () => {
        expect(gen_locale_args('he', 'rtl')).toBe(', lang: "he", dir: rtl')
        expect(gen_locale_args('vi', null)).toBe(', lang: "vi"')
        // Same language code, other script (e.g. Sanskrit in Devanagari vs Urdu script)
        expect(gen_locale_args(null, 'rtl')).toBe(', dir: rtl')
    })

})


describe('detect_dir', () => {

    it('reads the direction of the first letter', () => {
        expect(detect_dir('Hello שלום')).toBe('ltr')
        expect(detect_dir('שלום Hello')).toBe('rtl')
        expect(detect_dir('مرحبا')).toBe('rtl')
        expect(detect_dir('ܫܠܡܐ')).toBe('rtl')
        expect(detect_dir('Привет')).toBe('ltr')
    })

    it('skips digits, punctuation and spaces', () => {
        expect(detect_dir('1. "שלום"')).toBe('rtl')
        expect(detect_dir('  (3) Hello')).toBe('ltr')
    })

    it('has no direction for text without letters', () => {
        expect(detect_dir('')).toBeNull()
        expect(detect_dir('2026 — 1:1')).toBeNull()
    })
})


describe('gen_detected_dir_arg', () => {

    it('passes the detected direction, or nothing to inherit', () => {
        expect(gen_detected_dir_arg('בראשית')).toBe(', dir: rtl')
        expect(gen_detected_dir_arg('Genesis')).toBe(', dir: ltr')
        expect(gen_detected_dir_arg('1:1')).toBe('')
    })
})

