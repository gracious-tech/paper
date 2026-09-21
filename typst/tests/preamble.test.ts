
import {describe, it, expect} from 'vitest'

import {gen_preamble} from '../src/preamble.js'
import {CHAPTER_HEADING_LEVEL} from '../src/helpers.js'
import {make_passage, make_request, TEST_PAGE, TEST_TYPOGRAPHY, TEST_FEATURES}
    from './fixtures.js'


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
        // line_height 1.75 with 10pt font = 1.75 * 10 = 17.50pt (the whole line advance, since
        // top-edge/bottom-edge 0pt below zeroes out the font's own metric contribution)
        const result = gen_preamble(make_request())
        expect(result).toContain('leading: 17.50pt')
    })

    it('zeroes text top-edge/bottom-edge so leading is the whole line advance', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('top-edge: 0pt, bottom-edge: 0pt')
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

    it('sets the document language', () => {
        const result = gen_preamble(make_request({
            typography: {...TEST_TYPOGRAPHY, lang: 'vi'},
        }))
        expect(result).toContain('lang: "vi"')
    })

    it('includes first-line-indent', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('first-line-indent')
    })

    it('includes footnote separator styling', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('#set footnote.entry(separator:')
    })

    // Must be emitted here rather than per-passage: a page resolves its footnote area against the
    // style chain in force before any content, so a footnote.entry rule that follows content on
    // the page is silently ignored (see the note beside this rule in preamble.ts)
    it('sizes footnote entries from typography.footnote_size', () => {
        const result = gen_preamble(make_request())
        expect(result).toContain('#show footnote.entry: set text(size: 8.5pt)')
    })

    it('includes page footer when running_pages is true', () => {
        const result = gen_preamble(make_request({running_pages: true}))
        expect(result).toContain('counter(page).display()')
    })

    it('sets footer to none when running_pages and running_headings are both false', () => {
        const result = gen_preamble(make_request({running_pages: false, running_headings: false}))
        expect(result).toContain('footer: none')
    })

    it('drops the furniture on a page carrying an inline passage title', () => {
        const result = gen_preamble(make_request({running_pages: true,
            content: [make_passage({passage_title: 'Genesis'})]}))
        expect(result).toContain('query(<pb-title>)')
    })

    it('skips the title-page query when no item has an inline title', () => {
        const result = gen_preamble(make_request({running_pages: true}))
        expect(result).not.toContain('query(<pb-title>)')
    })

    it('footer text has no font: override, so it inherits font_text + its fallbacks', () => {
        const result = gen_preamble(make_request({running_pages: true}))
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
            expect(result).toContain('if n > 1')
            expect(result).toContain('line(length: 100%, stroke: 0.5pt)')
            // The visual is factored out so the bilingual columns layout can draw it once at
            // full grid width (see gen_multi_bible_grids)
            expect(result).toContain('#let ch_divider(n) =')
            // No font: override — inherits font_text + its fallbacks, same as regular body text
            const divider_source = result.slice(
                result.indexOf('#let ch_divider(n)'), result.indexOf('#let vn(n, ..rest)'))
            expect(divider_source).not.toContain('font:')
        })

        it('always defines a state-only #ch_quiet for the bilingual columns layout', () => {
            for (const style of ['divider', 'float', 'heading'] as const) {
                const result = gen_preamble(make_request({
                    features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: style},
                }))
                expect(result).toContain('#let ch_quiet(n, ..rest) = state("running-chapter", 0).update(n)')
            }
        })

        it('flags a following heading as tight, under the divider style only', () => {
            // A chapter opening straight into a heading uses #ch_tight, which tells that heading
            // to sit one line slot below the divider rather than adding its own leading space
            // (see tighten_chapter_before_heading in content_passage.ts)
            const divider = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'divider'},
            }))
            expect(divider).toContain('#let ch_tight(n, ..rest) = {')
            expect(divider).toContain('state("heading-tight", false).update(true)')
            // Every other style has nothing to add, so the marker is just the plain one
            for (const style of ['float', 'heading'] as const) {
                const result = gen_preamble(make_request({
                    features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: style},
                }))
                expect(result).toContain('#let ch_tight(n, ..rest) = ch(n)')
            }
            expect(gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: false},
            }))).toContain('#let ch_tight(n, ..rest) = ch(n)')
        })

        it('generates float chapter style', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float'},
            }))
            expect(result).toContain('#let ch(n, ..rest) =')
            expect(result).toContain('place(')
            // The single-digit design size, kept whenever the margin can hold it (measure() is
            // still used, only to offset the numeral by its own width)
            expect(result).toContain('size: 2.2em')
            // Flags the chapter as just-opened so a following heading can rise level with it
            expect(result).toContain('state("ch-float-open", false).update(true)')
            // The zero-height block sticks to the text it opens, so a break right after it can't
            // strand the numeral at the foot of the previous page
            expect(result).toContain('block(below: 0pt, height: 0pt, sticky: true,')
        })

        it('steps the float numeral down as the chapter number gets longer', () => {
            // The design ladder, applied whether or not the margin is under pressure — sized once
            // for the whole document, so every chapter number matches rather than stepping down at
            // 10 and again at 100. Wide margins, so nothing here is capped by the fit
            const float_preamble = (max_chapter:number, margin = '30mm') => gen_preamble(
                make_request({
                    max_chapter,
                    page: {...TEST_PAGE, margin_left: margin, margin_right: margin},
                    features: {...TEST_FEATURES, show_chapters: true,
                        show_chapters_style: 'float'},
                }))
            expect(float_preamble(9)).toContain('size: 2.2em')
            expect(float_preamble(50)).toContain('size: 1.8em')
            expect(float_preamble(150)).toContain('size: 1.5em')
            // A very narrow margin still caps it below the ladder
            expect(float_preamble(150, '10mm')).toContain('size: 1.2em')
            // Narrower margins shrink it further, but never below the floor where it would stop
            // reading as a chapter opener
            const tight = gen_preamble(make_request({
                max_chapter: 150,
                page: {...TEST_PAGE, margin_left: '6mm', margin_right: '6mm'},
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float'},
            }))
            expect(tight).toContain('size: 1.2em')
        })

        it('gives the float style a divider fallback for two-column passages', () => {
            // A page column has no margin to hang the numeral in, so two-column passages re-bind
            // #ch to this pair (see gen_passage_inner in content_passage.ts)
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float'},
            }))
            expect(result).toContain('#let ch_divider(n) =')
            expect(result).toContain('#let ch_columns(n, ..rest) = {')
            expect(result).toContain('#let ch_columns_tight(n, ..rest) = {')
            // Defined before use — Typst closures capture the scope they're created in
            expect(result.indexOf('#let ch_divider(n)'))
                .toBeLessThan(result.indexOf('#let ch_columns(n, ..rest)'))
            // No other style needs it
            for (const style of ['divider', 'heading'] as const) {
                expect(gen_preamble(make_request({
                    features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: style},
                }))).not.toContain('#let ch_columns(n, ..rest)')
            }
        })

        it('generates heading chapter style at its own heading level', () => {
            // Its own level is what keeps it visible when section headings are switched off
            // (see gen_heading_rules in content_passage.ts)
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'heading'},
            }))
            expect(result).toContain(
                `heading(level: ${CHAPTER_HEADING_LEVEL}, "Chapter " + str(n))`)
            expect(CHAPTER_HEADING_LEVEL).not.toBe(1)
        })

        it('hides chapters when show_chapters is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: false},
            }))
            expect(result).toContain('#let ch(n, ..rest) = state("running-chapter", 0).update(n)')
        })
    })

    // --- Verse marker (#vn) ---

    describe('verse marker', () => {

        it('generates visible verse markers', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_verses: true},
            }))
            expect(result).toContain('#let vn(n, ..rest) =')
            expect(result).toContain('super(str(n))')
            // A narrow no-break space keeps the number glued to the following word
            expect(result).toContain('sym.space.nobreak.narrow')
        })

        it('hides verses when show_verses is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_verses: false},
            }))
            expect(result).toContain('#let vn(n, ..rest) = []')
        })

        it('clears the float chapter-open flag under the float style', () => {
            // Under 'float' the first verse of a chapter clears the just-opened flag so a later
            // mid-chapter heading keeps its normal leading (see the #ch note in preamble.ts)
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'float',
                    show_verses: true},
            }))
            const vn_source = result.slice(
                result.indexOf('#let vn(n, ..rest)'), result.indexOf('#let wj('))
            expect(vn_source).toContain('state("ch-float-open", false).update(false)')
        })

        it('leaves the verse marker flag-free under non-float styles', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_chapters: true, show_chapters_style: 'divider',
                    show_verses: true},
            }))
            expect(result).toContain(
                '#let vn(n, ..rest) = [#text(weight: "bold", super(str(n)))#sym.space.nobreak.narrow]')
        })
    })

    // --- Words of Jesus (#wj) ---

    describe('words of jesus', () => {

        it('defines wj with the chosen color when show_wj is true', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: '#cc0000'},
            }))
            expect(result).toContain('#let wj(body, ..rest) = text(fill: rgb("#cc0000"), body)')
        })

        it('applies bold and italic styling when enabled', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: null,
                    show_wj_bold: true, show_wj_italic: true},
            }))
            expect(result).toContain('#let wj(body, ..rest) = text(weight: "bold", style: "italic", body)')
        })

        it('leaves wj as a pass-through when show_wj is on but no styling is chosen', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: true, show_wj_color: null,
                    show_wj_bold: false, show_wj_italic: false},
            }))
            expect(result).toContain('#let wj(body, ..rest) = body')
        })

        it('defines a plain wj pass-through when show_wj is false', () => {
            const result = gen_preamble(make_request({
                features: {...TEST_FEATURES, show_wj: false},
            }))
            expect(result).toContain('#let wj(body, ..rest) = body')
        })
    })
})
