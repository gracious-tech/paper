
import {describe, it, expect} from 'vitest'

import {gen_preamble} from '../src/preamble.js'
import {make_request, TEST_PAGE, TEST_TYPOGRAPHY} from './fixtures.js'


describe('gen_preamble', () => {

    it('includes document title', () => {
        const result = gen_preamble(make_request({title: 'My Bible'}))
        expect(result).toContain('#set document(title: "My Bible")')
    })

    it('escapes quotes in title', () => {
        const result = gen_preamble(make_request({title: 'The "Good" Book'}))
        expect(result).toContain('title: "The \\"Good\\" Book"')
    })

    it('sets page dimensions', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('width: 148mm')
        expect(result).toContain('height: 210mm')
    })

    it('uses left/right margins when margin_swap is false', () => {
        const result = gen_preamble(make_request({
            page: {...TEST_PAGE, margin_swap: false},
        }))
        expect(result).toContain('left: 15mm')
        expect(result).toContain('right: 15mm')
        expect(result).not.toContain('inside:')
        expect(result).not.toContain('outside:')
    })

    it('uses inside/outside margins when margin_swap is true', () => {
        const result = gen_preamble(make_request({
            page: {...TEST_PAGE, margin_swap: true},
        }))
        expect(result).toContain('inside: 15mm')
        expect(result).toContain('outside: 15mm')
        // The page margin spec should not use left/right (those are reserved for non-swap)
        expect(result).not.toContain('left: 15mm')
        expect(result).not.toContain('right: 15mm')
    })

    it('sets font family and fallbacks', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('"Crimson Pro"')
        expect(result).toContain('"Georgia"')
        expect(result).toContain('"serif"')
    })

    it('sets font size', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('size: 10pt')
    })

    it('calculates leading from line_height', () => {
        // line_height 1.75 with 10pt font = (1.75 - 1) * 10 = 7.50pt
        const result = gen_preamble(make_request())
        expect(result).toContain('leading: 7.50pt')
    })

    it('sets justify true when explicitly true', () => {
        const result = gen_preamble(make_request({
            typography: {...TEST_TYPOGRAPHY, justify: true},
        }))
        expect(result).toContain('justify: true')
    })

    it('sets justify false when explicitly false', () => {
        const result = gen_preamble(make_request({
            typography: {...TEST_TYPOGRAPHY, justify: false},
        }))
        expect(result).toContain('justify: false')
    })

    it('sets justify true when null (auto)', () => {
        const result = gen_preamble(make_request({
            typography: {...TEST_TYPOGRAPHY, justify: null},
        }))
        expect(result).toContain('justify: true')
    })

    it('includes first-line-indent', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('first-line-indent')
    })

    it('includes footnote separator styling', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('#set footnote.entry(separator:')
    })

    it('includes page footer when show_pages is true', () => {
        const result = gen_preamble(make_request({show_pages: true}))
        expect(result).toContain('counter(page).display()')
    })

    it('sets footer to none when show_pages is false', () => {
        const result = gen_preamble(make_request({show_pages: false}))
        expect(result).toContain('footer: none')
    })

    it('includes default wj function', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('#let wj(body) = body')
    })
})
