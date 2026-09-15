
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
        expect(one_col).toContain('#block(width: 100%, below: 2.8em, {')
        expect(one_col).not.toContain('scope: "parent"')
    })

})


describe('justification', () => {

    // Typography with justification left on 'auto', the case the per-item measure resolves
    const auto = {...TEST_TYPOGRAPHY, justify: null}

    // A one-slide picture story, whose body is fitted to its box at render time
    const story = {type: 'picture_story',
        slides: [{image: null, body: 'Jesus calmed the storm.', body2: null}]} as const

    // The preamble justifies for everything but an explicit `false`, so a justified item needs
    // no rule of its own — only turning justification back off is ever emitted
    it('leaves a full-measure passage to the preamble', () => {
        const result = generate_typst(make_request({
            typography: auto,
            content: [make_passage({columns: 1})],
        }))
        expect(result).toContain('justify: true,')
        expect(result).not.toContain('#set par(justify:')
    })

    it('justifies 2-column and bilingual measures at a normal body size', () => {
        // ~32 characters a line on the test page — narrow, but what printed bibles do
        const two_col = generate_typst(make_request({
            typography: auto,
            content: [make_passage({columns: 2})],
        }))
        expect(two_col).not.toContain('#set par(justify:')

        const bilingual = generate_typst(make_request({
            typography: auto,
            content: [make_passage({
                bibles: [{content: 'a'}, {content: 'b'}],
                multi_layout: 'columns',
            })],
        }))
        expect(bilingual).not.toContain('#set par(justify:')
    })

    it('stops justifying once the font size eats the measure', () => {
        // Same half-width columns as above, but ~20 characters a line at 16pt
        const two_col = generate_typst(make_request({
            typography: {...auto, font_size: '16pt'},
            content: [make_passage({columns: 2})],
        }))
        expect(two_col).toContain('#set par(justify: false)')

        // Large print alone is enough, even across the full page width
        const large_print = generate_typst(make_request({
            typography: {...auto, font_size: '26pt'},
            content: [make_passage({columns: 1})],
        }))
        expect(large_print).toContain('#set par(justify: false)')
    })

    it('demands a wider measure when hyphenation is off', () => {
        const typography = {...auto, hyphenate: false}
        const two_col = generate_typst(make_request({
            typography,
            content: [make_passage({columns: 2})],
        }))
        expect(two_col).toContain('#set par(justify: false)')

        const full = generate_typst(make_request({
            typography,
            content: [make_passage({columns: 1})],
        }))
        expect(full).not.toContain('#set par(justify:')
    })

    it('never justifies anything but a passage or custom page', () => {
        // Title pages, lines pages and picture stories, even with justification forced on
        for (const item of [make_title(), make_lines(), story]) {
            const result = generate_typst(make_request({
                typography: {...TEST_TYPOGRAPHY, justify: true},
                content: [item],
            }))
            expect(result).toContain('#set par(justify: false)')
            expect(result).not.toContain('#set par(justify: true)')
        }
    })

    it('applies an explicit choice to running text, whatever the measure', () => {
        for (const justify of [true, false]) {
            const result = generate_typst(make_request({
                typography: {...TEST_TYPOGRAPHY, justify, font_size: '26pt'},
                content: [make_passage({columns: 2}), make_custom()],
            }))
            // The preamble's rule carries it — neither item disagrees with it
            expect(result).toContain(`justify: ${justify},`)
            expect(result).not.toContain('#set par(justify:')
        }
    })

    it('emits one rule for a run of items that agree', () => {
        const result = generate_typst(make_request({
            typography: {...auto, font_size: '16pt'},
            content: [make_passage({columns: 2}), make_passage({columns: 2}), story],
        }))
        expect(result.match(/#set par\(justify: false\)/g)).toHaveLength(1)
    })

    it('does not leak an unjustified item\'s setting into the items that follow', () => {
        const result = generate_typst(make_request({
            typography: {...auto, font_size: '16pt'},
            content: [make_passage({columns: 2}), make_passage({columns: 1})],
        }))
        expect(result.indexOf('#set par(justify: false)'))
            .toBeLessThan(result.indexOf('#set par(justify: true)'))
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


describe('running-head state', () => {

    // A page's header/footer lays out before its own body, so the furniture on the compile's
    // first page can only see the states' initial values — those must therefore already carry
    // what the opening item's state reset sets, or that page shows an empty book and chapter 0

    it('seeds the states from the item the compile opens on', () => {
        const result = generate_typst(make_request({
            content: [make_passage({book_name: 'Exodus', start_chapter: 3})],
        }))
        expect(result).toContain('state("running-active", true)')
        expect(result).toContain('state("running-book", "Exodus")')
        expect(result).toContain('state("running-chapter", 3)')
    })

    it('seeds a half-blank passage with its fixed physical side', () => {
        const result = generate_typst(make_request({
            content: [make_passage({half_blank: 'left'})],
        }))
        expect(result).toContain('state("running-side", "right")')
    })

    it('leaves the states inert when the compile opens on a title page', () => {
        const result = generate_typst(make_request({content: [make_title(), make_passage()]}))
        expect(result).toContain('state("running-active", false)')
        expect(result).toContain('state("running-chapter", 0)')
        expect(result).not.toContain('state("running-chapter", 1)')
    })

    it('resets the states at each further item', () => {
        const result = generate_typst(make_request({
            content: [make_passage(), make_passage({book_name: 'Exodus'})],
        }))
        expect(result).toContain('.update("Exodus")')
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

    it('seeds the running heading from the passage, so the first spread is not blank', () => {
        const result = generate_typst_facing(
            {...facing_request(), running_headings: true},
            {...facing_passage(), book_name: 'Exodus', start_chapter: 3})
        expect(result).toContain('state("running-book", "Exodus").at(here())')
        expect(result).toContain('str(state("running-chapter", 3).at(here()))')
    })

    it('confines footnote entries to the left half', () => {
        const result = generate_typst_facing(facing_request(), facing_passage())
        expect(result).toContain('box(width: 148mm - 10mm - 20mm,')
    })

    it('confines study-note entries with footnotes off, before shadowing #footnote', () => {
        const result = generate_typst_facing(
            facing_request(), {...facing_passage(), show_footnotes: false})
        const rule = result.indexOf('#show footnote.entry: it => box(')
        const shadow = result.indexOf('#let footnote(..args) = none')
        expect(rule).toBeGreaterThan(-1)
        // The shadow makes #footnote a user-defined function, and `footnote.entry` after it is
        // a field access on that function — a compile error, so the rule has to come first
        expect(rule).toBeLessThan(shadow)
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
