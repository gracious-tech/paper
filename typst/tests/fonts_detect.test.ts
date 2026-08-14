
import {describe, it, expect} from 'vitest'

import {init_fonts} from 'typst-fonts'
import {detect_font_fallbacks} from '../src/fonts_detect.js'
import {make_passage, make_title, make_custom} from './fixtures.js'


describe('detect_font_fallbacks', () => {

    it('always includes a style-matched Greek/Hebrew base regardless of content', () => {
        const result = detect_font_fallbacks([make_passage()], 'Crimson Pro')
        // 'Crimson Pro' has no loaded manifest entry, so safe_font_style() defaults to serif
        expect(result).toContain('Noto Serif')
        expect(result).not.toContain('Noto Sans')
        expect(result).toContain('Noto Serif Hebrew')
        expect(result).not.toContain('Noto Sans Hebrew')
    })

    it('an explicit style overrides the curated-manifest lookup, e.g. for a custom font', () => {
        // 'My Custom Font' is not (and can't be, before init_fonts()) in any manifest — this is
        // exactly the case a caller with a user-uploaded font's known style needs to override
        const result = detect_font_fallbacks([make_passage()], 'My Custom Font', 'sans')
        expect(result).toContain('Noto Sans')
        expect(result).not.toContain('Noto Serif')
        expect(result).toContain('Noto Sans Hebrew')
        expect(result).not.toContain('Noto Serif Hebrew')
    })

    it('detects a script present in a passage\'s first paragraph', () => {
        const result = detect_font_fallbacks([
            make_passage({bibles: [{content: '#vn(1)日本語のテキストです。'}]}),
        ], 'Crimson Pro')
        expect(result).toContain('Noto Serif JP')
    })

    it('detects a script present in title text', () => {
        const result = detect_font_fallbacks([
            make_title({title: 'কিতাবুল মোকাদ্দস', subtitle: ''}),
        ], 'Crimson Pro')
        expect(result.some(f => f.includes('Bengali'))).toBe(true)
    })

    it('detects a script present in custom page content', () => {
        const result = detect_font_fallbacks([
            make_custom({content: 'हिन्दी पवित्र बाइबिल'}),
        ], 'Crimson Pro')
        expect(result.some(f => f.includes('Devanagari'))).toBe(true)
    })

    it('ignores scripts appearing only after a passage\'s first paragraph', () => {
        const far_away = 'a'.repeat(50) + '\n\n' + '日本語'
        const result = detect_font_fallbacks([
            make_passage({bibles: [{content: far_away}]}),
        ], 'Crimson Pro')
        expect(result).not.toContain('Noto Sans JP')
    })

    it('deduplicates families found in multiple samples', () => {
        const result = detect_font_fallbacks([
            make_passage({bibles: [{content: '日本語'}]}),
            make_title({title: '日本語のタイトル', subtitle: ''}),
        ], 'Crimson Pro')
        expect(result.filter(f => f === 'Noto Serif JP').length).toBe(1)
    })

    it('resolves each translation slot\'s CJK region independently from its own text', () => {
        // 们 is simplified-only, 氣 is traditional-only (see noto.js's HAN_HINTS comment) — a
        // bilingual Simplified + Traditional passage should get each side its own Noto region,
        // not have one script's detection bleed into the other's font scope
        const items = [make_passage({bibles: [
            {content: '他们说的话'}, {content: '他氣說的話'},
        ]})]
        const primary = detect_font_fallbacks(items, 'Crimson Pro', undefined, 0)
        expect(primary).toContain('Noto Serif SC')
        expect(primary).not.toContain('Noto Serif TC')

        const secondary = detect_font_fallbacks(items, 'Crimson Pro', undefined, 1)
        expect(secondary).toContain('Noto Serif TC')
        expect(secondary).not.toContain('Noto Serif SC')
    })

    it('a declared_variant override wins over sampled-text detection', () => {
        // Plain shared characters (identical in every Chinese region) are genuinely ambiguous
        // from text alone — this is exactly the case fetch.bible's script/region manifest tags
        // exist for (e.g. Hong Kong vs Taiwan Traditional, which share the same characters)
        const items = [make_passage({bibles: [{content: '你好'}]})]
        const result = detect_font_fallbacks(items, 'Crimson Pro', undefined, 0, 'HK')
        expect(result).toContain('Noto Serif HK')
        expect(result).not.toContain('Noto Serif SC')
    })

    it('slot 1 gets no samples (and no always-scripts) when there\'s no second translation', () => {
        const result = detect_font_fallbacks([make_passage()], 'Crimson Pro', undefined, 1)
        expect(result).toEqual([])
    })

    // Placed last: init_fonts() sets module-level state in typst-fonts for the rest of this
    // file's run, which would change the default-serif assumption the tests above rely on
    it('matches fallback style to a sans-serif chosen font once fonts are initialised', () => {
        init_fonts({font_manifest: [
            {family: 'Test Sans', group: 'Test', style: 'sans',
                files: ['TestSans-Regular.ttf'], preview_file: 'TestSans-Regular.ttf'},
        ]})
        const result = detect_font_fallbacks([
            make_passage({bibles: [{content: '日本語のテキストです。'}]}),
        ], 'Test Sans')
        expect(result).toContain('Noto Sans JP')
        expect(result).not.toContain('Noto Serif JP')
        expect(result).toContain('Noto Sans Hebrew')
        expect(result).not.toContain('Noto Serif Hebrew')
    })
})
