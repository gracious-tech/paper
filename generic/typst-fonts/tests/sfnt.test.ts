
import {describe, it, expect} from 'vitest'

import {parse_font_family, parse_font_style} from '../src/sfnt.js'
import {build_test_font} from './helpers.js'


describe('parse_font_family', () => {

    it('reads the Windows-platform Family name record', () => {
        const font = build_test_font({family: 'My Test Font'})
        expect(parse_font_family(font)).toBe('My Test Font')
    })

    it('returns null for a malformed/non-font buffer', () => {
        expect(parse_font_family(new Uint8Array([1, 2, 3]))).toBeNull()
    })
})


describe('parse_font_style', () => {

    it('classifies sFamilyClass 8 as sans', () => {
        const font = build_test_font({family: 'Test', family_class: 8})
        expect(parse_font_style(font)).toBe('sans')
    })

    it('classifies sFamilyClass 1-7 as serif', () => {
        const font = build_test_font({family: 'Test', family_class: 3})
        expect(parse_font_style(font)).toBe('serif')
    })

    it('returns null when the font declares neither and has no OS/2 table', () => {
        const font = build_test_font({family: 'Test', no_os2: true})
        expect(parse_font_style(font)).toBeNull()
    })

    it('returns null when OS/2 is present but declares neither sFamilyClass nor PANOSE', () => {
        const font = build_test_font({family: 'Test'})
        expect(parse_font_style(font)).toBeNull()
    })
})
