
import {describe, it, expect} from 'vitest'

import {gen_passage} from '../src/content_passage.js'
import {make_passage} from './fixtures.js'

import type {TypstPassage} from '../src/types.js'


// Default font args for tests that don't care about them (most — only the
// multi-bible grid tests below actually exercise the second-cell font override)
const FONT_SIZE = '10pt'
const FONT_TEXT2 = 'Crimson Pro'
const FONT_HEADINGS2 = 'Crimson Pro'
const FONT_FALLBACKS:string[] = []

function call(
    passage:TypstPassage, font_text2 = FONT_TEXT2, font_headings2 = FONT_HEADINGS2,
    font_fallbacks = FONT_FALLBACKS,
):string {
    return gen_passage(passage, FONT_SIZE, font_text2, font_headings2, font_fallbacks)
}


describe('gen_passage', () => {

    // Note: chapter (#ch), verse (#vn) and words-of-Jesus (#wj) markers are now defined
    // document-wide in the preamble \u2014 see preamble.test.ts for their coverage.

    // --- Heading rules ---

    describe('heading rules', () => {

        it('generates heading show rules when show_headings is true', () => {
            const result = call(make_passage({show_headings: true}))
            expect(result).toContain('#show heading.where(level: 1)')
            expect(result).toContain('#show heading.where(level: 2)')
            expect(result).toContain('#show heading.where(level: 3)')
        })

        it('hides headings when show_headings is false', () => {
            const result = call(make_passage({show_headings: false}))
            expect(result).toContain('#show heading: none')
        })

        it('level 2 headings are italic', () => {
            const result = call(make_passage({show_headings: true}))
            // Level 2 rule should contain italic
            const level2_match = result.match(
                /#show heading\.where\(level: 2\)[\s\S]*?style: "italic"/,
            )
            expect(level2_match).not.toBeNull()
        })
    })

    // --- Footnote rules ---

    describe('footnote rules', () => {

        it('shows footnotes with visible alphabetic call markers', () => {
            const result = call(make_passage({
                show_footnotes: true,
            }))
            expect(result).toContain('#show footnote.entry')
            // Alphabetic enumeration and a visible in-text mark (no empty-numbering override)
            expect(result).toContain('#set footnote(numbering: "a")')
            expect(result).not.toContain('numbering: it => []')
        })

        it('hides footnotes entirely when show_footnotes is false', () => {
            const result = call(make_passage({show_footnotes: false}))
            // Shadow the footnote function so notes (call, entry, and separator) never render
            expect(result).toContain('#let footnote(..args) = none')
        })
    })

    // --- Column layout ---

    describe('columns', () => {

        it('forces 2-column layout when columns is 2', () => {
            const result = call(make_passage({columns: 2}))
            expect(result).toContain('#columns(2')
        })

        it('forces single-column layout when columns is 1', () => {
            const result = call(make_passage({columns: 1, book: 'psa'}))
            expect(result).not.toContain('#columns(')
        })

        it('auto-detects columns for large poetry books', () => {
            const result = call(make_passage({columns: 'auto', book: 'psa'}))
            expect(result).toContain('#columns(2')
        })

        it('auto-detects single column for non-poetry books', () => {
            const result = call(make_passage({columns: 'auto', book: 'gen'}))
            expect(result).not.toContain('#columns(')
        })

        it('uses column_gap value', () => {
            const result = call(make_passage({columns: 2, column_gap: '8mm'}))
            expect(result).toContain('gutter: 8mm')
        })
    })

    // --- Poetry indent ---

    describe('poetry indent', () => {

        it('disables first-line-indent for poetry books', () => {
            const result = call(make_passage({book: 'psa'}))
            expect(result).toContain('#set par(first-line-indent: 0em)')
        })

        it('keeps default indent for non-poetry books', () => {
            const result = call(make_passage({book: 'gen'}))
            expect(result).not.toContain('first-line-indent: 0em')
        })
    })

    // --- Multi-bible grid ---

    describe('multi-bible grid', () => {

        it('renders grid for 2 bibles with columns layout', () => {
            const result = call(make_passage({
                bibles: [
                    {content: 'Bible 1 content'},
                    {content: 'Bible 2 content'},
                ],
                multi_layout: 'columns',
            }))
            expect(result).toContain('#grid(')
            expect(result).toContain('columns: (1fr, 1fr)')
            expect(result).toContain('[Bible 1 content]')
            expect(result).toContain('Bible 2 content]')
        })

        it('scopes the second cell to font_text2/font_headings2, leaving the first untouched', () => {
            const result = gen_passage(make_passage({
                bibles: [
                    {content: 'Bible 1 content'},
                    {content: 'Bible 2 content'},
                ],
                multi_layout: 'columns',
            }), FONT_SIZE, 'Second Font', 'Second Heading Font', ['Fallback Font'])

            // First cell stays a bare bracketed block — no font override leaking in
            expect(result).toContain('[Bible 1 content]')

            // Second cell carries its own font/heading-font override just ahead of its content
            const second_cell_start = result.indexOf('#set text(font: ("Second Font"')
            expect(second_cell_start).toBeGreaterThan(-1)
            const second_cell = result.slice(second_cell_start)
            expect(second_cell).toContain('#set text(font: ("Second Font", "Fallback Font"))')
            expect(second_cell).toContain('#show heading: set text(font: "Second Heading Font")')
            expect(second_cell).toContain('Bible 2 content')
        })

        it('does not use grid for single bible', () => {
            const result = call(make_passage({
                bibles: [{content: 'Solo bible'}],
            }))
            expect(result).not.toContain('#grid(')
        })
    })

    // --- Passage title ---

    describe('passage title', () => {

        it('renders passage title when provided', () => {
            const result = call(make_passage({
                passage_title: 'Genesis 1:1-31',
            }))
            expect(result).toContain('Genesis 1:1-31')
            expect(result).toContain('weight: "bold"')
        })

        it('omits passage title when null', () => {
            const result = call(make_passage({passage_title: null}))
            expect(result).not.toContain('#align(center, text(weight: "bold"')
        })
    })

    // --- Scoped block ---

    describe('scoped block', () => {

        it('wraps output in a scoped #[...] block', () => {
            const result = call(make_passage())
            expect(result).toContain('#[')
            expect(result.trimEnd().endsWith(']')).toBe(true)
        })
    })
})
