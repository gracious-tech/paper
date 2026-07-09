
// Note: manifest.ts holds module-level state, so ordering within this file matters — the
// "before init" tests run first, then init_fonts() applies for the rest of the file (vitest
// isolates modules per test file, so other files are unaffected)

import {describe, it, expect} from 'vitest'

import {init_fonts, get_fonts, get_bundled_font, base_font, font_style} from '../src/manifest.js'

import type {BundledFont} from '../src/manifest.js'


const TEST_MANIFEST:BundledFont[] = [
    {family: 'Noto Serif', group: 'Noto', style: 'serif',
        files: ['NotoSerif-Regular.ttf'], preview_file: 'NotoSerif-Regular.ttf'},
    {family: 'Test Sans', group: 'Test', style: 'sans',
        files: ['TestSans-Regular.ttf'], preview_file: 'TestSans-Regular.ttf'},
]


describe('manifest', () => {

    it('throws a clear error when used before init_fonts()', () => {
        expect(() => get_fonts()).toThrow(/init_fonts/)
        expect(() => base_font()).toThrow(/init_fonts/)
    })

    it('font_style() with an explicit style still needs the manifest', () => {
        // Consistent with the rest of the module — see typst's safe_font_style for the
        // degrade-gracefully wrapper used when the manifest may not be loaded
        expect(() => font_style('Anything')).toThrow(/init_fonts/)
    })

    it('init_fonts() rejects a malformed manifest', () => {
        expect(() => init_fonts({font_manifest: 'nope' as unknown as BundledFont[]}))
            .toThrow(/expects/)
        expect(() => init_fonts({font_manifest: [{} as BundledFont]})).toThrow(/expects/)
    })

    it('get_fonts() returns a copy that cannot mutate the loaded manifest', () => {
        init_fonts({font_manifest: TEST_MANIFEST})
        const fonts = get_fonts()
        fonts[0]!.family = 'Mutated'
        fonts[0]!.files.push('Extra.ttf')
        expect(get_fonts()[0]!.family).toBe('Noto Serif')
        expect(get_fonts()[0]!.files).toEqual(['NotoSerif-Regular.ttf'])
    })

    it('get_bundled_font() looks up by family name', () => {
        expect(get_bundled_font('Test Sans')?.style).toBe('sans')
        expect(get_bundled_font('Unknown')).toBeUndefined()
    })

    it('base_font() is the first manifest entry', () => {
        expect(base_font()).toBe('Noto Serif')
    })

    it('font_style() prefers explicit, then manifest, then serif', () => {
        expect(font_style('Test Sans', 'serif')).toBe('serif')
        expect(font_style('Test Sans')).toBe('sans')
        expect(font_style('Unknown Custom Font')).toBe('serif')
    })

    it('base_font() throws a clear error on an empty manifest', () => {
        init_fonts({font_manifest: []})
        expect(() => base_font()).toThrow(/empty/)
    })
})
