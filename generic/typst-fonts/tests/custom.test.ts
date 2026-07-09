
import {describe, it, expect} from 'vitest'
import {zipSync} from 'fflate'

import {process_font_files} from '../src/custom.js'
import {build_test_font} from './helpers.js'


describe('process_font_files', () => {

    it('groups multiple weight files into one family', () => {
        const result = process_font_files([
            {name: 'TestFont-Regular.ttf', data: build_test_font({family: 'Test Font'})},
            {name: 'TestFont-Bold.ttf', data: build_test_font({family: 'Test Font'})},
        ])
        expect(result).toHaveLength(1)
        expect(result[0]!.family).toBe('Test Font')
        expect(result[0]!.files).toHaveLength(2)
    })

    it('classifies style from OS/2 sFamilyClass when present', () => {
        const result = process_font_files([
            {name: 'Sans.ttf', data: build_test_font({family: 'A Sans Family', family_class: 8})},
        ])
        expect(result[0]!.style).toBe('sans')
    })

    it('falls back to a name-based guess when no file declares a style', () => {
        const result = process_font_files([
            {name: 'Foo.ttf', data: build_test_font({family: 'Foo Sans', no_os2: true})},
        ])
        expect(result[0]!.style).toBe('sans')
    })

    it('defaults to serif when neither declared style nor name gives a hint', () => {
        const result = process_font_files([
            {name: 'Foo.ttf', data: build_test_font({family: 'Foo Display', no_os2: true})},
        ])
        expect(result[0]!.style).toBe('serif')
    })

    it('excludes exotic weights and variable fonts on the filtered pass', () => {
        // A Regular file (from a different family) keeps the filtered pass non-empty, so the
        // unfiltered fallback never kicks in — isolating the exclusion itself from that fallback
        const result = process_font_files([
            {name: 'TestFont-Thin.ttf', data: build_test_font({family: 'Excluded Font'})},
            {name: 'TestFont[wght].ttf', data: build_test_font({family: 'Excluded Font'})},
            {name: 'OtherFont-Regular.ttf', data: build_test_font({family: 'Other Font'})},
        ])
        expect(result.map(f => f.family)).toEqual(['Other Font'])
    })

    it('retries unfiltered when the filtered pass yields no families (e.g. Thin/Bold-only zip)', () => {
        const result = process_font_files([
            {name: 'TestFont-Thin.ttf', data: build_test_font({family: 'Test Font'})},
        ])
        expect(result).toHaveLength(1)
        expect(result[0]!.family).toBe('Test Font')
    })

    it('extracts font files from a zip archive', () => {
        const zip_data = zipSync({
            'TestFont-Regular.ttf': build_test_font({family: 'Zipped Font'}),
        })
        const result = process_font_files([{name: 'fonts.zip', data: zip_data}])
        expect(result).toHaveLength(1)
        expect(result[0]!.family).toBe('Zipped Font')
    })

    it('ignores files with no parseable family name', () => {
        const result = process_font_files([
            {name: 'garbage.ttf', data: new Uint8Array([1, 2, 3])},
        ])
        expect(result).toHaveLength(0)
    })

    it('skips a corrupt zip without failing the other uploads', () => {
        const result = process_font_files([
            {name: 'broken.zip', data: new Uint8Array([1, 2, 3])},
            {name: 'TestFont-Regular.ttf', data: build_test_font({family: 'Test Font'})},
        ])
        expect(result.map(f => f.family)).toEqual(['Test Font'])
    })
})
