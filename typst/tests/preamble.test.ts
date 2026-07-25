
import {describe, it, expect} from 'vitest'

import {gen_preamble} from '../src/preamble.js'
import {make_request, TEST_PAGE, TEST_TYPOGRAPHY, TEST_FEATURES} from './fixtures.js'


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

    it('uses inside/outside margins for binding-aware layout', () => {
        const result = gen_preamble(make_request({page: TEST_PAGE}))
        expect(result).toContain('inside: 15mm')
        expect(result).toContain('outside: 15mm')
        expect(result).not.toContain('left: 15mm')
        expect(result).not.toContain('right: 15mm')
    })

    it('sets font family and fallbacks', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('"Crimson Pro"')
        expect(result).toContain('"Georgia"')
        expect(result).toContain('"serif"')
    })

    it('sets the heading font document-wide, regardless of chapter/heading settings', () => {
        const result = gen_preamble(make_request({
            features: {...TEST_FEATURES, show_chapters: false},
        }))
        expect(result).toContain('#show heading: set text(font: "Crimson Pro")')
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

    it('footer text has no font: override, so it inherits font_text + its fallbacks', () => {
        const result = gen_preamble(make_request({show_pages: true}))
        const footer_source = result.slice(
            result.indexOf('footer:'), result.indexOf('footer-descent'))
        expect(footer_source).not.toContain('font:')
    })

    // --- Chapter marker (#ch) ---

    describe('chapter marker', () => {

        it('generates divider chapter style', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'divider'},
            }))
            expect(result).toContain('#let ch(n) = if n > 1')
            expect(result).toContain('———')
            // No font: override — inherits font_text + its fallbacks, same as regular body text
            const divider_source = result.slice(
                result.indexOf('#let ch(n)'), result.indexOf('#let vn(n)'))
            expect(divider_source).not.toContain('font:')
        })

        it('generates float chapter style', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float'},
            }))
            expect(result).toContain('#let ch(n) =')
            expect(result).toContain('place(')
            // Sized to a fixed em value (not scaled to a measured line height), placed in the
            // page's left margin (measure() is still used, only to offset by the numeral's width)
            expect(result).toContain('size: 2.5em')
            // Flags the chapter as just-opened so a following heading can rise level with it
            expect(result).toContain('state("ch-float-open", false).update(true)')
        })

        it('generates heading chapter style', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'heading'},
            }))
            expect(result).toContain('#let ch(n) = heading(level: 1, "Chapter " + str(n))')
        })

        it('hides chapters when show_chapters is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: false},
            }))
            expect(result).toContain('#let ch(n) = []')
        })
    })

    // --- Verse marker (#vn) ---

    describe('verse marker', () => {

        it('generates visible verse markers', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_verses: true},
            }))
            expect(result).toContain('#let vn(n) =')
            expect(result).toContain('super(str(n))')
            // A narrow no-break space keeps the number glued to the following word
            expect(result).toContain('sym.space.nobreak.narrow')
        })

        it('hides verses when show_verses is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_verses: false},
            }))
            expect(result).toContain('#let vn(n) = []')
        })

        it('clears the float chapter-open flag under the float style', () => {
            // Under 'float' the first verse of a chapter clears the just-opened flag so a later
            // mid-chapter heading keeps its normal leading (see the #ch note in preamble.ts)
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float',
                    show_verses: true},
            }))
            const vn_source = result.slice(
                result.indexOf('#let vn(n)'), result.indexOf('#let wj('))
            expect(vn_source).toContain('state("ch-float-open", false).update(false)')
        })

        it('leaves the verse marker flag-free under non-float styles', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'divider',
                    show_verses: true},
            }))
            expect(result).toContain(
                '#let vn(n) = [#text(weight: "bold", super(str(n)))#sym.space.nobreak.narrow]')
        })
    })

    // --- Words of Jesus (#wj) ---

    describe('words of jesus', () => {

        it('defines wj with the chosen color when show_wj is true', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: '#cc0000'},
            }))
            expect(result).toContain('#let wj(body) = text(fill: rgb("#cc0000"), body)')
        })

        it('applies bold and italic styling when enabled', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: null,
                    show_wj_bold: true, show_wj_italic: true},
            }))
            expect(result).toContain('#let wj(body) = text(weight: "bold", style: "italic", body)')
        })

        it('leaves wj as a pass-through when show_wj is on but no styling is chosen', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: null,
                    show_wj_bold: false, show_wj_italic: false},
            }))
            expect(result).toContain('#let wj(body) = body')
        })

        it('defines a plain wj pass-through when show_wj is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: false},
            }))
            expect(result).toContain('#let wj(body) = body')
        })
    })
})
