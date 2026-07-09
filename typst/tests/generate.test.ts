
import {describe, it, expect} from 'vitest'

import {generate_typst, generate_typst_passage, generate_typst_blank,
    generate_typst_lines, group_content} from '../src/generate.js'
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

    it('uses #pagebreak(to: "even") for alone items in book mode', () => {
        const result = generate_typst(make_request({
            arrangement: 'book',
            content: [
                make_title({alone: true}),
                make_passage(),
            ],
        }))
        expect(result).toContain('#pagebreak(to: "even")')
    })

    it('uses simple #pagebreak() in normal mode', () => {
        const result = generate_typst(make_request({
            arrangement: 'normal',
            content: [
                make_title({alone: true}),
                make_passage(),
            ],
        }))
        expect(result).toContain('#pagebreak()')
        // Should not have "to: even" forced by alone flag in normal mode
        // (it appears before the second item, but alone items get even pagebreaks in book mode)
        const even_breaks = (result.match(/#pagebreak\(to: "even"\)/g) || []).length
        expect(even_breaks).toBe(0)
    })

    it('no pagebreak before first item', () => {
        const result = generate_typst(make_request({
            content: [make_passage()],
        }))
        // Preamble first, then passage — no pagebreak between them
        expect(result).not.toContain('#pagebreak()')
    })
})


describe('group_content', () => {

    it('puts each new_page item in its own group', () => {
        const groups = group_content([make_passage(), make_passage(), make_custom()])
        expect(groups.map(g => g.length)).toEqual([1, 1, 1])
    })

    it('merges a new_page=false item into the group above', () => {
        const groups = group_content([
            make_passage(),
            make_custom({new_page: false}),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0]).toHaveLength(2)
    })

    it('does not merge into a title (title is not a mergeable head)', () => {
        const groups = group_content([
            make_title(),
            make_custom({new_page: false}),
        ])
        expect(groups).toHaveLength(2)
    })

    it('does not merge into an alternate-translation passage', () => {
        const groups = group_content([
            make_passage({bibles: [{content: 'a'}, {content: 'b'}], multi_layout: 'alternate'}),
            make_custom({new_page: false}),
        ])
        expect(groups).toHaveLength(2)
    })

    it('forces an alternate-translation passage onto its own page even when merged', () => {
        const groups = group_content([
            make_custom(),
            make_passage({
                bibles: [{content: 'a'}, {content: 'b'}],
                multi_layout: 'alternate',
                new_page: false,
            }),
        ])
        expect(groups).toHaveLength(2)
    })

    it('still merges into a half-blank passage (blanks added after render)', () => {
        const groups = group_content([
            make_passage({half_blank: 'right'}),
            make_custom({new_page: false}),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0]).toHaveLength(2)
    })
})


describe('merged content page breaks', () => {

    it('omits the page break between merged items', () => {
        const merged = generate_typst(make_request({
            content: [make_passage(), make_custom({new_page: false})],
        }))
        // A single group means no page break at all (only preamble + the two items)
        expect(merged).not.toContain('#pagebreak()')
    })

    it('keeps the page break when the item starts on a new page', () => {
        const split = generate_typst(make_request({
            content: [make_passage(), make_custom({new_page: true})],
        }))
        expect(split).toContain('#pagebreak()')
    })

    it('does not position a custom when items are merged below it', () => {
        // A bottom-positioned custom followed by a merged passage must flow inline, otherwise the
        // positioning block would push the passage onto the next page
        const merged = generate_typst(make_request({
            content: [
                make_custom({position: 'bottom', content: 'INTRO'}),
                make_passage({new_page: false}),
            ],
        }))
        expect(merged).not.toContain('align(bottom, body)')
        expect(merged).not.toContain('#pagebreak()')
    })

    it('positions a custom alone on its page, falling back to flow when it overflows', () => {
        const alone = generate_typst(make_request({
            content: [make_custom({position: 'bottom'})],
        }))
        // Full-height alignment when it fits, else render the body in normal flow
        expect(alone).toContain('align(bottom, body)')
        expect(alone).toContain('measure(box(width: size.width, body))')
    })
})


describe('generate_typst_passage', () => {

    it('generates a document for a single bible from a multi-bible passage', () => {
        const passage = make_passage({
            bibles: [
                {content: 'NIV content'},
                {content: 'ESV content'},
            ],
        })
        const result = generate_typst_passage(make_request(), passage, 0)
        expect(result).toContain('NIV content')
        expect(result).not.toContain('ESV content')
    })

    it('generates for the second bible', () => {
        const passage = make_passage({
            bibles: [
                {content: 'NIV content'},
                {content: 'ESV content'},
            ],
        })
        const result = generate_typst_passage(make_request(), passage, 1)
        expect(result).toContain('ESV content')
        expect(result).not.toContain('NIV content')
    })

    it('includes preamble', () => {
        const passage = make_passage()
        const result = generate_typst_passage(make_request(), passage, 0)
        expect(result).toContain('#set page(')
    })

    it('uses font_text/font_headings for the first bible, font_text2/font_headings2 for the second', () => {
        const passage = make_passage({
            bibles: [{content: 'NIV content'}, {content: 'ESV content'}],
        })
        const request = make_request({typography: {
            ...TEST_TYPOGRAPHY, font_text: 'First Font', font_headings: 'First Heading Font',
            font_text2: 'Second Font', font_headings2: 'Second Heading Font',
        }})

        const first = generate_typst_passage(request, passage, 0)
        expect(first).toContain('#set text(font: ("First Font"')
        expect(first).toContain('#show heading: set text(font: "First Heading Font")')

        const second = generate_typst_passage(request, passage, 1)
        expect(second).toContain('#set text(font: ("Second Font"')
        expect(second).toContain('#show heading: set text(font: "Second Heading Font")')
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
