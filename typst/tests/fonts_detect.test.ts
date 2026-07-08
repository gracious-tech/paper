
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
