
import {describe, it, expect} from 'vitest'

import {get_noto_font, detect_scripts, detect_cjk_variant, field_cjk_variant, cjk_segments,
    cjk_family, script_family, resolve_fallback_chain} from '../src/noto.js'


describe('get_noto_font', () => {

    it('looks up a bundled Noto family by name', () => {
        const font = get_noto_font('Noto Serif Hebrew')
        expect(font?.family).toBe('Noto Serif Hebrew')
        expect(font?.files.length).toBeGreaterThan(0)
    })

    it('returns undefined for unknown families', () => {
        expect(get_noto_font('Comic Sans')).toBeUndefined()
    })
})


describe('detect_scripts', () => {

    it('detects each non-Latin script present in the text', () => {
        const scripts = detect_scripts('Hello שלום مرحبا')
        expect(scripts).toContain('Hebrew')
        expect(scripts).toContain('Arabic')
    })

    it('never reports Latin (already covered by the curated font)', () => {
        expect(detect_scripts('Just plain English text')).toEqual(new Set())
    })
})


describe('detect_cjk_variant', () => {

    it('kana anywhere means Japanese', () => {
        expect(detect_cjk_variant('聖書のことば')).toBe('JP')
    })

    it('Hangul anywhere means Korean', () => {
        expect(detect_cjk_variant('성경 말씀')).toBe('KR')
    })

    it('simplified-only characters mean SC', () => {
        expect(detect_cjk_variant('这是简体中文的圣经')).toBe('SC')
    })

    it('traditional-only characters mean TC', () => {
        expect(detect_cjk_variant('這是繁體中文的聖經')).toBe('TC')
    })

    it('all-shared characters default to SC (broadest coverage)', () => {
        // 中/文/山/水 are written identically in simplified and traditional Chinese
        expect(detect_cjk_variant('中文山水')).toBe('SC')
    })
})


describe('field_cjk_variant', () => {

    it('classifies from the field text when it carries a signal', () => {
        expect(field_cjk_variant('简体中文', 'JP')).toBe('SC')
    })

    it('inherits the cover-wide default when the field is ambiguous', () => {
        expect(field_cjk_variant('Latin only text', 'TC')).toBe('TC')
    })
})


describe('cjk_segments', () => {

    it('classifies separate sentences with their own region', () => {
        const text = '日本語のテキストです。这是简体中文。'
        const segments = cjk_segments(text, 'SC')
        expect(segments.map(s => s.region)).toEqual(['JP', 'SC'])
    })

    it('keeps Han characters with their sentence\'s kana context across Latin interruptions', () => {
        // 'bold' interrupts the sentence but 漢字 must stay JP thanks to the kana around it
        const text = '漢字 bold のテキストです。'
        const segments = cjk_segments(text, 'SC')
        expect(segments.every(s => s.region === 'JP')).toBe(true)
        // Segments must cover only CJK runs, never the Latin interruption
        for (const segment of segments) {
            expect(text.slice(segment.start, segment.end)).not.toContain('bold')
        }
    })

    it('merges adjacent same-region pieces', () => {
        const segments = cjk_segments('日本語のテキスト', 'SC')
        expect(segments).toHaveLength(1)
    })

    it('returns no segments for text without CJK characters', () => {
        expect(cjk_segments('No CJK here', 'SC')).toEqual([])
    })
})


describe('cjk_family / script_family', () => {

    it('resolves a CJK region and style to its Noto family', () => {
        expect(cjk_family('JP', 'serif')).toBe('Noto Serif JP')
        expect(cjk_family('TC', 'sans')).toBe('Noto Sans TC')
    })

    it('resolves a script and style to its Noto family', () => {
        expect(script_family('Hebrew', 'sans')).toBe('Noto Sans Hebrew')
    })

    it('falls back to the other style when Noto lacks the preferred one', () => {
        // Noto has no Serif Arabic — rendering something beats style purity
        expect(script_family('Arabic', 'serif')).toBe('Noto Sans Arabic')
    })

    it('returns null for scripts Noto does not cover', () => {
        expect(script_family('Klingon', 'serif')).toBeNull()
    })
})


describe('resolve_fallback_chain', () => {

    it('returns one style-matched family per detected script', () => {
        const chain = resolve_fallback_chain('Hello שלום 日本語です', 'SC', 'serif')
        expect(chain).toContain('Noto Serif Hebrew')
        expect(chain).toContain('Noto Serif JP')
        expect(chain).not.toContain('Noto Sans Hebrew')
    })

    it('includes every CJK region used by mixed-language text', () => {
        const chain = resolve_fallback_chain('日本語のテキストです。这是简体中文。', 'SC', 'sans')
        expect(chain).toContain('Noto Sans JP')
        expect(chain).toContain('Noto Sans SC')
    })

    it('resolves ambiguous Han-only text through the han_variant tiebreaker', () => {
        expect(resolve_fallback_chain('中文山水', 'TC', 'serif')).toEqual(['Noto Serif TC'])
    })

    it('returns nothing for Latin-only text', () => {
        expect(resolve_fallback_chain('Plain English', 'SC', 'serif')).toEqual([])
    })
})
