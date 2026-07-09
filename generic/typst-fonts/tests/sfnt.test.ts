
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

    it('rejects a buffer without a valid sfnt version tag', () => {
        const font = build_test_font({family: 'Test', version: 0x12345678})
        expect(parse_font_family(font)).toBeNull()
    })

    it('prefers the typographic family (nameID 16) over the legacy family (nameID 1)', () => {
        const font = build_test_font({family: '', name_records: [
            {platform_id: 3, name_id: 1, value: 'Foo SemiBold'},
            {platform_id: 3, name_id: 16, value: 'Foo'},
        ]})
        expect(parse_font_family(font)).toBe('Foo')
    })

    it('prefers a Windows-platform record over an earlier Mac one', () => {
        // Mac records sort first in real fonts' name tables, but their single-byte encoding
        // garbles non-ASCII names — the Windows UTF-16 record must win regardless of order
        const font = build_test_font({family: '', name_records: [
            {platform_id: 1, name_id: 1, value: 'Mac Name'},
            {platform_id: 3, name_id: 1, value: '思源黑体'},
        ]})
        expect(parse_font_family(font)).toBe('思源黑体')
    })

    it('still reads a Mac-only name table', () => {
        const font = build_test_font({family: '', name_records: [
            {platform_id: 1, name_id: 1, value: 'Mac Only'},
        ]})
        expect(parse_font_family(font)).toBe('Mac Only')
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
