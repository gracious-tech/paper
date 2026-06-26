
import {describe, it, expect} from 'vitest'

import {escape_typst, indent, parse_unit, LARGE_POETRY, LOTS_OF_POETRY} from '../src/helpers.js'


describe('escape_typst', () => {

    it('escapes all special Typst characters', () => {
        const input = '#v(1) hello [world] $x* _bold_ `code` <tag> @ref ~space'
        const result = escape_typst(input)
        // Each special char should be preceded by backslash
        expect(result).toContain('\\#')
        expect(result).toContain('\\[')
        expect(result).toContain('\\]')
        expect(result).toContain('\\$')
        expect(result).toContain('\\*')
        expect(result).toContain('\\_')
        expect(result).toContain('\\`')
        expect(result).toContain('\\<')
        expect(result).toContain('\\>')
        expect(result).toContain('\\@')
        expect(result).toContain('\\~')
    })

    it('escapes backslashes', () => {
        expect(escape_typst('a\\b')).toBe('a\\\\b')
    })

    it('passes through normal text unchanged', () => {
        expect(escape_typst('Hello world 123')).toBe('Hello world 123')
    })

    it('handles empty string', () => {
        expect(escape_typst('')).toBe('')
    })

    it('escapes multiple occurrences', () => {
        expect(escape_typst('##')).toBe('\\#\\#')
    })
})


describe('indent', () => {

    it('indents each line by default 4 spaces', () => {
        expect(indent('a\nb')).toBe('    a\n    b')
    })

    it('indents by custom number of spaces', () => {
        expect(indent('hello', 2)).toBe('  hello')
    })

    it('does not indent empty lines', () => {
        expect(indent('a\n\nb')).toBe('    a\n\n    b')
    })

    it('handles single line', () => {
        expect(indent('hello')).toBe('    hello')
    })

    it('handles empty string', () => {
        expect(indent('')).toBe('')
    })
})


describe('parse_unit', () => {

    it('parses millimeters', () => {
        expect(parse_unit('210mm')).toEqual({num: 210, unit: 'mm'})
    })

    it('parses centimeters', () => {
        expect(parse_unit('2.5cm')).toEqual({num: 2.5, unit: 'cm'})
    })

    it('parses inches', () => {
        expect(parse_unit('8.5in')).toEqual({num: 8.5, unit: 'in'})
    })

    it('parses points', () => {
        expect(parse_unit('10pt')).toEqual({num: 10, unit: 'pt'})
    })

    it('parses em', () => {
        expect(parse_unit('1.5em')).toEqual({num: 1.5, unit: 'em'})
    })

    it('throws for invalid input', () => {
        expect(() => parse_unit('invalid')).toThrow('Invalid Typst unit string')
    })

    it('throws for unsupported units', () => {
        expect(() => parse_unit('10px')).toThrow('Invalid Typst unit string')
    })

    it('throws for missing number', () => {
        expect(() => parse_unit('mm')).toThrow('Invalid Typst unit string')
    })
})


describe('constants', () => {

    it('LARGE_POETRY contains expected books', () => {
        expect(LARGE_POETRY).toContain('psa')
        expect(LARGE_POETRY).toContain('isa')
        expect(LARGE_POETRY).toContain('job')
    })

    it('LOTS_OF_POETRY is a superset of LARGE_POETRY', () => {
        for (const book of LARGE_POETRY) {
            expect(LOTS_OF_POETRY).toContain(book)
        }
    })

    it('LOTS_OF_POETRY contains minor prophets', () => {
        expect(LOTS_OF_POETRY).toContain('hos')
        expect(LOTS_OF_POETRY).toContain('amo')
        expect(LOTS_OF_POETRY).toContain('mic')
    })
})
