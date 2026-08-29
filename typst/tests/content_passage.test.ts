
import {describe, it, expect} from 'vitest'

import {gen_passage, passage_columns} from '../src/content_passage.js'
import {make_passage, TEST_PAGE} from './fixtures.js'

import type {ChapterStyle} from '../src/content_passage.js'
import type {TypstPassage} from '../src/types.js'


// Default font args for tests that don't care about them (most — only the
// multi-bible grid tests below actually exercise the second-cell font override)
const FONT_SIZE = '10pt'
const FONT_TEXT2 = 'Crimson Pro'
const FONT_HEADINGS2 = 'Crimson Pro'
const FONT_SIZE2 = '10pt'
const FONT_FALLBACKS:string[] = []
const LINE_HEIGHT = 1.75

function call(
    passage:TypstPassage, font_text2 = FONT_TEXT2, font_headings2 = FONT_HEADINGS2,
    font_fallbacks = FONT_FALLBACKS, font_size2 = FONT_SIZE2, line_height = LINE_HEIGHT,
    chapter_style:ChapterStyle = 'none', poetry_outdent = true,
):string {
    return gen_passage(passage, TEST_PAGE, 'padded', FONT_SIZE, font_text2, font_headings2,
        font_size2, font_fallbacks, line_height, chapter_style, poetry_outdent)
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

        it('drops heading leading space when a float chapter just opened or at a cell top', () => {
            // A heading immediately after a 'float' #ch, or first in a side-by-side grid cell,
            // reads the shared flag(s) and skips its leading v() (see gen_heading_rules)
            const result = call(make_passage({show_headings: true}))
            expect(result).toContain('if not open and not cell_top { v(')
            expect(result).toContain('set text(top-edge: 0pt) if cell_top')
            expect(result).toContain('state("ch-float-open", false).get()')
            expect(result).toContain('state("bilingual-cell-top", false).get()')
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

        // Columns are set at page level by generate_typst (see gen_page_columns there) —
        // gen_passage itself must never emit a #columns block (a book-length block region
        // made footnote layout explode in memory)

        it('never emits a #columns block', () => {
            const result = call(make_passage({columns: 2}))
            expect(result).not.toContain('#columns(')
        })

        it('passage_columns honors a forced column count', () => {
            expect(passage_columns(make_passage({columns: 2, book: 'gen'}))).toBe(2)
            expect(passage_columns(make_passage({columns: 1, book: 'psa'}))).toBe(1)
        })

        it('passage_columns auto-detects by book', () => {
            expect(passage_columns(make_passage({columns: 'auto', book: 'psa'}))).toBe(2)
            expect(passage_columns(make_passage({columns: 'auto', book: 'gen'}))).toBe(1)
        })

        it('passage_columns never combines with a multi-translation layout', () => {
            for (const multi_layout of ['columns', 'alternate'] as const) {
                expect(passage_columns(make_passage({
                    columns: 2,
                    bibles: [{content: 'a'}, {content: 'b'}],
                    multi_layout,
                }))).toBe(1)
            }
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

        it('outdents poetry levels for poetry books', () => {
            const result = call(make_passage({book: 'psa'}))
            expect(result).toContain('#let q(n, c) = q_base(n, c, base: 1)')
            expect(result).toContain('#let qm(n, c) = qm_base(n, c, base: 1)')
        })

        it('leaves poetry levels alone for non-poetry books', () => {
            const result = call(make_passage({book: 'gen'}))
            expect(result).not.toContain('q_base(n, c, base: 1)')
        })

        it('respects poetry_outdent = false even for poetry books', () => {
            const result = call(make_passage({book: 'psa'}), undefined, undefined, undefined,
                undefined, undefined, 'none', false)
            expect(result).not.toContain('first-line-indent: 0em')
            expect(result).not.toContain('q_base(n, c, base: 1)')
        })
    })

    // --- Multi-bible aligned grids ---

    describe('multi-bible aligned grids', () => {

        it('renders a grid for 2 bibles with columns layout', () => {
            const result = call(make_passage({
                bibles: [
                    {content: '#vn(1)Bible 1 content'},
                    {content: '#vn(1)Bible 2 content'},
                ],
                multi_layout: 'columns',
            }))
            expect(result).toContain('#grid(')
            expect(result).toContain('columns: (1fr, 1fr)')
            expect(result).toContain('Bible 1 content')
            expect(result).toContain('Bible 2 content')
        })

        it('emits one separate grid per alignment row, never one passage-length grid', () => {
            // Two chapters of two paragraphs each — paragraph alignment must yield 4 grids
            // (a single many-row grid is one layout container and reintroduces the footnote
            // memory blowup)
            const content = (name:string) => `#ch(1)\n\n#vn(1)${name} one one.\n\n`
                + `#vn(2)${name} one two.\n\n#ch(2)\n\n#vn(1)${name} two one.\n\n`
                + `#vn(2)${name} two two.`
            const result = call(make_passage({
                bibles: [{content: content('A')}, {content: content('B')}],
                multi_layout: 'columns',
                multi_align: 'paragraph',
            }))
            expect((result.match(/#grid\(/g) ?? []).length).toBe(4)
        })

        it('adds a top margin before a heading-initial row, but not the first row', () => {
            // Primary opens straight into a verse; a later paragraph starts with a section
            // heading. The heading's own leading v() is suppressed at a cell top, so the row
            // gets a weak spacer instead — and the opening row never does.
            const a = '#ch(1)\n\n#vn(1)Alpha one.\n\n== A Section\n#vn(2)Alpha two.'
            const b = '#ch(1)\n\n#vn(1)Beta one.\n\n#vn(2)Beta two.'
            const result = call(make_passage({
                bibles: [{content: a}, {content: b}],
                multi_layout: 'columns',
                multi_align: 'paragraph',
            }))
            // Exactly one row-level spacer, and it sits before the second grid (not the first)
            const spacers = result.match(/#v\([\d.]+em, weak: true\)/g) ?? []
            expect(spacers.length).toBe(1)
            const first_grid = result.indexOf('#grid(')
            expect(result.indexOf(spacers[0]!)).toBeGreaterThan(first_grid)
        })

        it('scales heading margins with line_height', () => {
            const tight = call(make_passage({show_headings: true}), FONT_TEXT2, FONT_HEADINGS2,
                FONT_FALLBACKS, FONT_SIZE2, 1.5)
            const loose = call(make_passage({show_headings: true}), FONT_TEXT2, FONT_HEADINGS2,
                FONT_FALLBACKS, FONT_SIZE2, 3.0)
            // Level-2 leading gap: 1.09 lines × line_height
            expect(tight).toContain(`v(${(1.09 * 1.5).toFixed(3)}em)`)
            expect(loose).toContain(`v(${(1.09 * 3.0).toFixed(3)}em)`)
        })

        it('chapter alignment yields one grid per chapter', () => {
            const content = (name:string) => `#ch(1)\n\n#vn(1)${name} one one.\n\n`
                + `#vn(2)${name} one two.\n\n#ch(2)\n\n#vn(1)${name} two one.`
            const result = call(make_passage({
                bibles: [{content: content('A')}, {content: content('B')}],
                multi_layout: 'columns',
                multi_align: 'chapter',
            }))
            expect((result.match(/#grid\(/g) ?? []).length).toBe(2)
        })

        // --- Bilingual chapter markers ---
        // The chapter marker sits in both translations' markup, so left alone it draws twice.

        const bilingual_chapters = (chapter_style:ChapterStyle) => {
            const content = (name:string) =>
                `#ch(1)\n\n#vn(1)${name} one.\n\n#ch(2)\n\n#vn(1)${name} two.`
            return call(make_passage({
                bibles: [{content: content('A')}, {content: content('B')}],
                multi_layout: 'columns',
                multi_align: 'chapter',
            }), FONT_TEXT2, FONT_HEADINGS2, FONT_FALLBACKS, FONT_SIZE2, LINE_HEIGHT, chapter_style)
        }

        it('divider style: one full-width divider per chapter, no in-cell markers', () => {
            const result = bilingual_chapters('divider')
            // A single divider drawn at grid width for chapter 2 (chapter 1's is suppressed)
            expect((result.match(/#ch_divider\(/g) ?? []).length).toBe(1)
            expect(result).toContain('#ch_divider(2)')
            expect(result).not.toContain('#ch_divider(1)')
            // Both translations fall back to the state-only marker
            expect(result).not.toMatch(/#ch\(\d+\)/)
            expect(result).toContain('#ch_quiet(1)')
            expect(result).toContain('#ch_quiet(2)')
        })

        it('drop-cap (float) style: quiets only the second translation\'s marker', () => {
            const result = bilingual_chapters('float')
            // Primary keeps its real marker (draws the margin numeral); second is quieted so it
            // doesn't repeat the numeral into the column gutter
            expect(result).toContain('#ch(1)')
            expect(result).toContain('#ch(2)')
            expect(result).toContain('#ch_quiet(1)')
            expect(result).toContain('#ch_quiet(2)')
            expect(result.indexOf('#ch(1)')).toBeLessThan(result.indexOf('#ch_quiet(1)'))
            expect(result).not.toContain('#ch_divider(')
        })

        it('heading style: leaves both translations\' markers untouched', () => {
            const result = bilingual_chapters('heading')
            expect(result).toContain('#ch(1)')
            expect(result).toContain('#ch(2)')
            expect(result).not.toContain('#ch_quiet(')
            expect(result).not.toContain('#ch_divider(')
        })

        it('scopes the second cell to font_text2/font_headings2, leaving the first untouched', () => {
            const result = gen_passage(make_passage({
                bibles: [
                    {content: '#vn(1)Bible 1 content'},
                    {content: '#vn(1)Bible 2 content'},
                ],
                multi_layout: 'columns',
            }), TEST_PAGE, 'padded', FONT_SIZE, 'Second Font', 'Second Heading Font', FONT_SIZE2,
                ['Fallback Font'], LINE_HEIGHT, 'none')

            // First cell carries no font override — the override sits ahead of the second only
            const second_cell_start = result.indexOf('#set text(font: ("Second Font"')
            expect(second_cell_start).toBeGreaterThan(-1)
            expect(result.slice(0, second_cell_start)).toContain('Bible 1 content')
            const second_cell = result.slice(second_cell_start)
            expect(second_cell)
                .toContain(`#set text(font: ("Second Font", "Fallback Font"), size: ${FONT_SIZE2})`)
            expect(second_cell).toContain('#show heading: set text(font: "Second Heading Font")')
            expect(second_cell).toContain('Bible 2 content')
        })

        it('suppresses footnotes in the second translation only', () => {
            const result = call(make_passage({
                bibles: [
                    {content: '#vn(1)Bible 1 content'},
                    {content: '#vn(1)Bible 2 content'},
                ],
                multi_layout: 'columns',
                show_footnotes: true,
            }))
            // The primary still shows notes (entry rule present), while the second cell
            // shadows #footnote so its notes never register
            expect(result).toContain('#show footnote.entry')
            const shadow = result.indexOf('#let footnote(..args) = none')
            expect(shadow).toBeGreaterThan(-1)
            expect(result.slice(shadow)).toContain('Bible 2 content')
            expect(result.slice(shadow)).not.toContain('Bible 1 content')
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

        it('renders subtitle beneath title when provided', () => {
            const result = call(make_passage({
                passage_title: 'Genesis 1:1-31',
                passage_subtitle: 'The Creation',
            }))
            expect(result).toContain('Genesis 1:1-31')
            expect(result).toContain('The Creation')
            expect(result).toContain('stack(spacing:')
        })

        it('omits subtitle stack when passage_subtitle is null', () => {
            const result = call(make_passage({
                passage_title: 'Genesis 1:1-31',
                passage_subtitle: null,
            }))
            expect(result).not.toContain('stack(spacing:')
        })
    })

    // --- Passage image ---

    describe('passage image', () => {

        const image = {filename: 'passage_img_test.jpg', bytes: new Uint8Array([1, 2, 3])}

        it('omits image markup when null', () => {
            const result = call(make_passage({image: null}))
            expect(result).not.toContain('passage_img_test.jpg')
        })

        it('renders the image before any title/content, in cover mode', () => {
            const result = call(make_passage({image, passage_title: 'Genesis 1:1-31'}))
            expect(result).toContain('image("passage_img_test.jpg"')
            expect(result).toContain('fit: "cover"')
            expect(result.indexOf('passage_img_test.jpg'))
                .toBeLessThan(result.indexOf('Genesis 1:1-31'))
        })

        it('stays in normal flow (no #place) in padded mode, respecting margins', () => {
            const result = gen_passage(make_passage({image}), TEST_PAGE, 'padded',
                FONT_SIZE, FONT_TEXT2, FONT_HEADINGS2, FONT_SIZE2, FONT_FALLBACKS)
            expect(result).not.toContain('#place(top + left')
            expect(result).toContain('#box(width: 100%')
        })

        it('bleeds past the page margins in borderless mode', () => {
            const result = gen_passage(make_passage({image}), TEST_PAGE, 'borderless',
                FONT_SIZE, FONT_TEXT2, FONT_HEADINGS2, FONT_SIZE2, FONT_FALLBACKS)
            expect(result).toContain('#place(top + left')
            expect(result).toContain(`dx: -${TEST_PAGE.margin_left}`)
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
