
import {describe, it, expect} from 'vitest'

import {escape_typst, indent, parse_unit, estimate_bytes, LruCache, LARGE_POETRY,
    LOTS_OF_POETRY} from '../src/helpers.js'


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


describe('estimate_bytes', () => {

    it('returns a small constant for null/undefined', () => {
        expect(estimate_bytes(null)).toBe(8)
        expect(estimate_bytes(undefined)).toBe(8)
    })

    it('estimates by JSON length', () => {
        expect(estimate_bytes('abc')).toBe(5)  // "abc" incl. quotes
        expect(estimate_bytes({a: 1})).toBe(JSON.stringify({a: 1}).length)
    })

    it('falls back to a large estimate for unserializable values', () => {
        const circular:Record<string, unknown> = {}
        circular['self'] = circular
        expect(estimate_bytes(circular)).toBe(1024 * 1024)
    })
})


describe('LruCache', () => {

    it('stores and retrieves values', () => {
        const cache = new LruCache<string>()
        cache.set('a', 'value', 10)
        expect(cache.get('a')).toBe('value')
        expect(cache.get('missing')).toBeUndefined()
        expect(cache.has('a')).toBe(true)
        expect(cache.has('missing')).toBe(false)
    })

    it('is unbounded when no cap is given', () => {
        const cache = new LruCache<number>()
        for (let i = 0; i < 100; i++) {
            cache.set(`k${i}`, i, 1000)
        }
        expect(cache.size).toBe(100)
        expect(cache.bytes).toBe(100_000)
    })

    it('evicts oldest entries when over the byte cap', () => {
        const cache = new LruCache<number>(25)
        cache.set('a', 1, 10)
        cache.set('b', 2, 10)
        cache.set('c', 3, 10)  // 30 > 25 → evict 'a'
        expect(cache.has('a')).toBe(false)
        expect(cache.has('b')).toBe(true)
        expect(cache.has('c')).toBe(true)
        expect(cache.bytes).toBe(20)
    })

    it('get() refreshes recency so hot entries survive eviction', () => {
        const cache = new LruCache<number>(25)
        cache.set('a', 1, 10)
        cache.set('b', 2, 10)
        cache.get('a')  // 'b' is now oldest
        cache.set('c', 3, 10)  // over cap → evict 'b', not 'a'
        expect(cache.has('a')).toBe(true)
        expect(cache.has('b')).toBe(false)
        expect(cache.has('c')).toBe(true)
    })

    it('replaces an existing key without double-counting bytes', () => {
        const cache = new LruCache<number>(100)
        cache.set('a', 1, 30)
        cache.set('a', 2, 50)
        expect(cache.get('a')).toBe(2)
        expect(cache.size).toBe(1)
        expect(cache.bytes).toBe(50)
    })

    it('keeps a single entry even if it alone exceeds the cap', () => {
        const cache = new LruCache<number>(10)
        cache.set('big', 1, 999)
        expect(cache.get('big')).toBe(1)
        // But it gets evicted as soon as anything newer arrives
        cache.set('next', 2, 5)
        expect(cache.has('big')).toBe(false)
        expect(cache.has('next')).toBe(true)
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
