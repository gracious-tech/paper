
import {describe, it, expect} from 'vitest'

import {gen_passage} from '../src/content_passage.js'
import {make_passage} from './fixtures.js'


describe('gen_passage', () => {

    // --- Chapter styles ---

    describe('chapter styles', () => {

        it('generates divider chapter style', () => {
            const result = gen_passage(make_passage({
                show_chapters: true,
                show_chapters_style: 'divider',
            }))
            expect(result).toContain('#let c(n) = if n > 1')
            expect(result).toContain('\u2014\u2014\u2014')
        })

        it('generates float chapter style', () => {
            const result = gen_passage(make_passage({
                show_chapters: true,
                show_chapters_style: 'float',
            }))
            expect(result).toContain('place(')
            expect(result).toContain('size: 2em')
        })

        it('generates heading chapter style', () => {
            const result = gen_passage(make_passage({
                show_chapters: true,
                show_chapters_style: 'heading',
            }))
            expect(result).toContain('"Chapter "')
        })

        it('hides chapters when show_chapters is false', () => {
            const result = gen_passage(make_passage({show_chapters: false}))
            expect(result).toContain('#let c(n) = []')
        })
    })

    // --- Verse markers ---

    describe('verse markers', () => {

        it('generates visible verse markers', () => {
            const result = gen_passage(make_passage({show_verses: true}))
            expect(result).toContain('#let v(n) = {')
            expect(result).toContain('super(str(n))')
            expect(result).toContain('size: 0.7em')
            expect(result).toContain('fill: gray')
        })

        it('hides verses when show_verses is false', () => {
            const result = gen_passage(make_passage({show_verses: false}))
            expect(result).toContain('#let v(n) = []')
        })
    })

    // --- Words of Jesus ---

    describe('words of jesus', () => {

        it('adds wj function with the chosen color when show_wj is true', () => {
            const result = gen_passage(make_passage({show_wj: true, show_wj_color: '#cc0000'}))
            expect(result).toContain('#let wj(body) = text(fill: rgb("#cc0000"), body)')
        })

        it('applies bold and italic styling when enabled', () => {
            const result = gen_passage(make_passage(
                {show_wj: true, show_wj_color: null, show_wj_bold: true, show_wj_italic: true}))
            expect(result).toContain('#let wj(body) = text(weight: "bold", style: "italic", body)')
        })

        it('leaves wj as a pass-through when no styling is chosen', () => {
            const result = gen_passage(make_passage(
                {show_wj: true, show_wj_color: null, show_wj_bold: false, show_wj_italic: false}))
            expect(result).toContain('#let wj(body) = text(body)')
        })

        it('does not add wj override when show_wj is false', () => {
            const result = gen_passage(make_passage({show_wj: false}))
            expect(result).not.toContain('fill: rgb')
        })
    })

    // --- Heading rules ---

    describe('heading rules', () => {

        it('generates heading show rules when show_headings is true', () => {
            const result = gen_passage(make_passage({show_headings: true}))
            expect(result).toContain('#show heading.where(level: 1)')
            expect(result).toContain('#show heading.where(level: 2)')
            expect(result).toContain('#show heading.where(level: 3)')
        })

        it('hides headings when show_headings is false', () => {
            const result = gen_passage(make_passage({show_headings: false}))
            expect(result).toContain('#show heading: none')
        })

        it('level 2 headings are italic', () => {
            const result = gen_passage(make_passage({show_headings: true}))
            // Level 2 rule should contain italic
            const level2_match = result.match(
                /#show heading\.where\(level: 2\)[\s\S]*?style: "italic"/,
            )
            expect(level2_match).not.toBeNull()
        })
    })

    // --- Footnote rules ---

    describe('footnote rules', () => {

        it('shows footnotes with calls by default', () => {
            const result = gen_passage(make_passage({
                show_footnotes: true,
                show_footnote_calls: true,
            }))
            expect(result).toContain('#show footnote.entry')
            expect(result).not.toContain('numbering: it => []')
        })

        it('hides footnote calls when show_footnote_calls is false', () => {
            const result = gen_passage(make_passage({
                show_footnotes: true,
                show_footnote_calls: false,
            }))
            expect(result).toContain('#set footnote(numbering: it => [])')
        })

        it('hides footnotes entirely when show_footnotes is false', () => {
            const result = gen_passage(make_passage({show_footnotes: false}))
            // Shadow the footnote function so notes (call, entry, and separator) never render
            expect(result).toContain('#let footnote(..args) = none')
        })
    })

    // --- Column layout ---

    describe('columns', () => {

        it('forces 2-column layout when columns is 2', () => {
            const result = gen_passage(make_passage({columns: 2}))
            expect(result).toContain('#columns(2')
        })

        it('forces single-column layout when columns is 1', () => {
            const result = gen_passage(make_passage({columns: 1, book: 'psa'}))
            expect(result).not.toContain('#columns(')
        })

        it('auto-detects columns for large poetry books', () => {
            const result = gen_passage(make_passage({columns: 'auto', book: 'psa'}))
            expect(result).toContain('#columns(2')
        })

        it('auto-detects single column for non-poetry books', () => {
            const result = gen_passage(make_passage({columns: 'auto', book: 'gen'}))
            expect(result).not.toContain('#columns(')
        })

        it('uses column_gap value', () => {
            const result = gen_passage(make_passage({columns: 2, column_gap: '8mm'}))
            expect(result).toContain('gutter: 8mm')
        })
    })

    // --- Poetry indent ---

    describe('poetry indent', () => {

        it('disables first-line-indent for poetry books', () => {
            const result = gen_passage(make_passage({book: 'psa'}))
            expect(result).toContain('#set par(first-line-indent: 0em)')
        })

        it('keeps default indent for non-poetry books', () => {
            const result = gen_passage(make_passage({book: 'gen'}))
            expect(result).not.toContain('first-line-indent: 0em')
        })
    })

    // --- Multi-bible grid ---

    describe('multi-bible grid', () => {

        it('renders grid for 2 bibles with columns layout', () => {
            const result = gen_passage(make_passage({
                bibles: [
                    {content: 'Bible 1 content'},
                    {content: 'Bible 2 content'},
                ],
                multi_layout: 'columns',
            }))
            expect(result).toContain('#grid(')
            expect(result).toContain('columns: (1fr, 1fr)')
            expect(result).toContain('[Bible 1 content]')
            expect(result).toContain('[Bible 2 content]')
        })

        it('does not use grid for single bible', () => {
            const result = gen_passage(make_passage({
                bibles: [{content: 'Solo bible'}],
            }))
            expect(result).not.toContain('#grid(')
        })
    })

    // --- Passage title ---

    describe('passage title', () => {

        it('renders passage title when provided', () => {
            const result = gen_passage(make_passage({
                passage_title: 'Genesis 1:1-31',
            }))
            expect(result).toContain('Genesis 1:1-31')
            expect(result).toContain('weight: "bold"')
        })

        it('omits passage title when null', () => {
            const result = gen_passage(make_passage({passage_title: null}))
            expect(result).not.toContain('#align(center, text(weight: "bold"')
        })
    })

    // --- Scoped block ---

    describe('scoped block', () => {

        it('wraps output in a scoped #[...] block', () => {
            const result = gen_passage(make_passage())
            expect(result).toContain('#[')
            expect(result.trimEnd().endsWith(']')).toBe(true)
        })
    })
})
