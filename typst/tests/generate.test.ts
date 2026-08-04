
import {describe, it, expect} from 'vitest'

import {generate_typst, generate_typst_facing, generate_typst_blank,
    generate_typst_lines} from '../src/generate.js'
import {make_request, make_passage, make_title, make_custom, make_lines,
    TEST_PAGE, TEST_TYPOGRAPHY} from './fixtures.js'


describe('generate_typst', () => {

    it('starts with preamble', () => {
        const result = generate_typst(make_request())
        expect(result).toContain('#set document(')
        expect(result).toContain('#set page(')
        expect(result).toContain('#set text(')
    })

    it('renders a single passage', () => {
        const result = generate_typst(make_request({
            content: [make_passage()],
        }))
        // Should contain passage content
        expect(result).toContain('In the beginning')
    })

    it('renders multiple content items with page breaks', () => {
        const result = generate_typst(make_request({
            content: [make_passage(), make_passage()],
        }))
        expect(result).toContain('#pagebreak()')
    })

    it('renders title page', () => {
        const result = generate_typst(make_request({
            content: [make_title()],
        }))
        expect(result).toContain('Holy Bible')
        expect(result).toContain('Dancing Script')
    })

    it('renders custom page', () => {
        const result = generate_typst(make_request({
            content: [make_custom({position: 'middle', content: 'Custom text'})],
        }))
        expect(result).toContain('Custom text')
        expect(result).toContain('align(horizon, body)')
    })

    it('renders lines page', () => {
        const result = generate_typst(make_request({
            content: [make_lines()],
        }))
        expect(result).toContain('dash: "dotted"')
    })

    it('mixed content types work together', () => {
        const result = generate_typst(make_request({
            content: [
                make_title(),
                make_passage(),
                make_custom({position: 'bottom', content: 'Copyright'}),
            ],
        }))
        expect(result).toContain('Holy Bible')
        expect(result).toContain('In the beginning')
        expect(result).toContain('Copyright')
    })
})


describe('page arrangement', () => {

    it('uses simple #pagebreak() between items regardless of arrangement', () => {
        // Page-side forcing for title pages (titlepage_always) is handled in pdf_postprocess.ts,
        // not here — generate_typst only ever compiles a single item's document in the real
        // pipeline (see compile_item in pdf_postprocess.ts), so it always uses a plain pagebreak
        const result = generate_typst(make_request({
            arrangement: 'book',
            content: [
                make_title(),
                make_passage(),
            ],
        }))
        expect(result).toContain('#pagebreak()')
        expect(result).not.toContain('#pagebreak(to:')
    })

    it('no pagebreak before first item', () => {
        const result = generate_typst(make_request({
            content: [make_passage()],
        }))
        // Preamble first, then passage — no pagebreak between them
        expect(result).not.toContain('#pagebreak()')
    })
})


describe('page-level columns', () => {

    it('sets 2 page columns for a forced 2-column passage (no #columns block)', () => {
        const result = generate_typst(make_request({
            content: [make_passage({columns: 2})],
        }))
        expect(result).toContain('#set page(columns: 2)')
        expect(result).toContain('#set columns(gutter: 5mm)')
        expect(result).not.toContain('#columns(')
    })

    it('sets 1 page column for a single-column passage', () => {
        const result = generate_typst(make_request({
            content: [make_passage({columns: 1})],
        }))
        expect(result).toContain('#set page(columns: 1)')
        expect(result).not.toContain('#set page(columns: 2)')
    })

    it('auto columns uses 2 for large poetry books and 1 for prose', () => {
        const poetry = generate_typst(make_request({
            content: [make_passage({columns: 'auto', book: 'psa'})],
        }))
        expect(poetry).toContain('#set page(columns: 2)')

        const prose = generate_typst(make_request({
            content: [make_passage({columns: 'auto', book: 'jhn'})],
        }))
        expect(prose).not.toContain('#set page(columns: 2)')
    })

    it('never combines page columns with the multi-bible grid', () => {
        const result = generate_typst(make_request({
            content: [make_passage({
                columns: 2,
                bibles: [{content: 'a'}, {content: 'b'}],
                multi_layout: 'columns',
            })],
        }))
        expect(result).toContain('#grid(')
        expect(result).not.toContain('#set page(columns: 2)')
    })

    it('floats the passage title to page scope on 2-column pages', () => {
        const two_col = generate_typst(make_request({
            content: [make_passage({columns: 2, passage_title: 'Psalms'})],
        }))
        expect(two_col).toContain('#place(top + center, scope: "parent", float: true,')

        const one_col = generate_typst(make_request({
            content: [make_passage({columns: 1, passage_title: 'Psalms'})],
        }))
        expect(one_col).toContain('#align(center,')
        expect(one_col).not.toContain('scope: "parent"')
    })

})


describe('custom page positioning', () => {

    it('positions a custom alone on its page, falling back to flow when it overflows', () => {
        const alone = generate_typst(make_request({
            content: [make_custom({position: 'bottom'})],
        }))
        // Full-height alignment when it fits, else render the body in normal flow
        expect(alone).toContain('align(bottom, body)')
        expect(alone).toContain('measure(box(width: size.width, body))')
    })
})


describe('generate_typst_facing', () => {

    // Distinct margins so the geometry assertions can tell inner (left) from outer (right)
    const facing_request = () => make_request({
        page: {...TEST_PAGE, margin_left: '10mm', margin_right: '20mm'},
    })
    const facing_passage = () => make_passage({
        bibles: [{content: '#vn(1)NIV content'}, {content: '#vn(1)ESV content'}],
        multi_layout: 'alternate',
    })

    it('doubles the page width and fixes both margins to the outer value', () => {
        const result = generate_typst_facing(facing_request(), facing_passage())
        expect(result).toContain('width: 2 * 148mm')
        expect(result).toContain('left: 20mm, right: 20mm')
        expect(result).not.toContain('inside:')
    })

    it('renders both translations as aligned rows with the centre gutter', () => {
        const result = generate_typst_facing(facing_request(), facing_passage())
        expect(result).toContain('NIV content')
        expect(result).toContain('ESV content')
        expect(result).toContain('#grid(')
        expect(result).toContain('column-gutter: 2 * 10mm')
    })

    it('prints a computed page number per half, offset by start_page', () => {
        const result = generate_typst_facing(facing_request(), facing_passage(), 7)
        expect(result).toContain('str(7 + 2 * (n - 1))')
        expect(result).toContain('str(7 + 2 * n - 1)')
    })

    it('omits page numbers when running_pages is off', () => {
        const request = {...facing_request(), running_pages: false}
        const result = generate_typst_facing(request, facing_passage())
        expect(result).toContain('footer: none')
    })

    it('confines footnote entries to the left half', () => {
        const result = generate_typst_facing(facing_request(), facing_passage())
        expect(result).toContain('box(width: 148mm - 10mm - 20mm,')
    })

    it('never uses page-level text columns', () => {
        const result = generate_typst_facing(
            facing_request(), {...facing_passage(), columns: 2})
        expect(result).not.toContain('#set page(columns: 2)')
    })

    it('repeats the passage title on both halves', () => {
        const result = generate_typst_facing(
            facing_request(), {...facing_passage(), passage_title: 'Psalms'})
        expect((result.match(/Psalms/g) ?? []).length).toBe(2)
    })

    it('gives the second cell its own fonts', () => {
        const request = make_request({typography: {
            ...TEST_TYPOGRAPHY, font_text: 'First Font', font_headings: 'First Heading Font',
            font_text2: 'Second Font', font_headings2: 'Second Heading Font',
        }})
        const result = generate_typst_facing(request, facing_passage())
        expect(result).toContain('#set text(font: ("Second Font"')
        expect(result).toContain('#show heading: set text(font: "Second Heading Font")')
    })
})


describe('generate_typst_blank', () => {

    it('generates minimal blank page document', () => {
        const result = generate_typst_blank(make_request())
        expect(result).toContain('#set page(')
        expect(result).toContain('width: 148mm')
        expect(result).toContain('height: 210mm')
    })

    it('does not include preamble fonts/text', () => {
        const result = generate_typst_blank(make_request())
        expect(result).not.toContain('#set text(')
    })
})


describe('generate_typst_lines', () => {

    it('generates a lines page document', () => {
        const result = generate_typst_lines(make_request(), '10mm')
        expect(result).toContain('#set page(')
        expect(result).toContain('#grid(')
        expect(result).toContain('dash: "dotted"')
    })

    it('uses the provided spacing', () => {
        const result = generate_typst_lines(make_request(), '7mm')
        expect(result).toContain('(7mm,)')
    })
})
