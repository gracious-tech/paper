
// The printed page sequence (assemble.ts), over a fake backend whose "documents" only record what
// was compiled, so the order of pages — and which physical side each was laid out for — can be
// read back without compiling any Typst. The PDF and SVG suites cover what the backends make of it

import {describe, it, expect} from 'vitest'

import {assemble_pages, assemble_reading_preview, trim_trailing_blanks} from '../src/assemble.js'
import {make_request, make_passage, make_title, make_custom, TEST_TITLEPAGE} from './fixtures.js'

import type {Assembly, PageBackend} from '../src/assemble.js'


// A compiled document: what it is, and how many pages it came to
interface FakeDoc {
    label:string
    pages:number
}


// A backend labelling each source by its kind ('passage', 'title', 'custom', 'lines' or a bare
// 'blank') and the side it was laid out for: `alt-<binding>` for margins that alternate by
// position, `fixed-<side>` for a page pinned to one side (see margin_overrides in generate.ts).
// Passages compile to `passage_pages` pages, everything else to one. `compiled` lists every
// compile, in order
function fake_backend(passage_pages = 2):PageBackend<FakeDoc> & {compiled:FakeDoc[]} {
    const compiled:FakeDoc[] = []
    return {
        compiled,
        async compile(source:string){
            const kind = source.includes('In the beginning') ? 'passage'
                : source.includes('Holy Bible') ? 'title'
                : source.includes('Copyright 2024') ? 'custom'
                // A blank is nothing but its #set page rule; a lines page adds its grid
                : source.indexOf('#', 1) === -1 ? 'blank' : 'lines'
            const binding = /binding: (left|right)/.exec(source)?.[1]
            const fixed = /, left: /.test(source)
            const doc = {label: `${kind} ${fixed ? 'fixed' : 'alt'}-${binding}`,
                pages: kind === 'passage' ? passage_pages : 1}
            compiled.push(doc)
            return doc
        },
        page_count: doc => doc.pages,
        async split_halves(doc){
            return {label: `${doc.label} halves`, pages: doc.pages * 2}
        },
    }
}


// The assembled sequence as labels, with the page index for multi-page documents
function read_pages(assembly:Assembly<FakeDoc>):string[] {
    return assembly.pages.map(({doc, index}) => doc.pages > 1 ? `${doc.label} #${index}` : doc.label)
}


describe('assemble_pages half-blank passages', () => {

    it('faces each page with a blank on the far side, content on the left', async () => {
        // half_blank 'right' = the blank half of each spread is the right page
        const backend = fake_backend()
        const request = make_request({arrangement: 'book',
            content: [make_passage({half_blank: 'right'})]})
        const assembly = await assemble_pages(request, backend)
        // A recto blank first, so each content page lands on a verso facing its notes page
        expect(read_pages(assembly)).toEqual([
            'blank alt-left',
            'passage fixed-left #0', 'blank fixed-right',
            'passage fixed-left #1', 'blank fixed-right',
        ])
        // The facing blank is compiled once and reused for every spread
        expect(backend.compiled.filter(doc => doc.label === 'blank fixed-right')).toHaveLength(1)
        expect(assembly.pages[2]!.doc).toBe(assembly.pages[4]!.doc)
    })

    it('puts the blank first when content goes on the right', async () => {
        const request = make_request({arrangement: 'book',
            content: [make_passage({half_blank: 'left'})]})
        expect(read_pages(await assemble_pages(request, fake_backend()))).toEqual([
            'blank alt-left',
            'blank fixed-left', 'passage fixed-right #0',
            'blank fixed-left', 'passage fixed-right #1',
        ])
    })

    it('needs no leading blank when the passage already starts on a verso', async () => {
        const request = make_request({arrangement: 'book',
            content: [make_title(), make_passage({half_blank: 'right'})]})
        expect(read_pages(await assemble_pages(request, fake_backend()))).toEqual([
            'title alt-left',
            'passage fixed-left #0', 'blank fixed-right',
            'passage fixed-left #1', 'blank fixed-right',
        ])
    })

    it('faces with ruled lines when asked, even where blanks are left out', async () => {
        // A normal (non-book) document has no padding blanks, but lines are content
        const request = make_request({arrangement: 'normal',
            content: [make_passage({half_blank: 'right', lines: 'wide'})]})
        const assembly = await assemble_pages(request, fake_backend())
        expect(read_pages(assembly)).toEqual([
            'passage fixed-left #0', 'lines fixed-right',
            'passage fixed-left #1', 'lines fixed-right',
        ])
        expect(assembly.blank_flags).toEqual([false, false, false, false])
    })

    it('leaves a normal document\'s blank half out altogether', async () => {
        const request = make_request({arrangement: 'normal',
            content: [make_passage({half_blank: 'right'})]})
        expect(read_pages(await assemble_pages(request, fake_backend())))
            .toEqual(['passage fixed-left #0', 'passage fixed-left #1'])
    })
})


describe('trim_trailing_blanks', () => {

    // An assembly of the given pages, true marking a padding blank
    const make_assembly = (flags:boolean[]):Assembly<FakeDoc> => {
        const blank = {label: 'blank', pages: 1}
        const content = {label: 'content', pages: 1}
        return {
            pages: flags.map(is_blank => ({doc: is_blank ? blank : content, index: 0})),
            blank: {left: blank, right: blank},
            blank_flags: [...flags],
        }
    }

    it('drops only the run of blanks at the very end', () => {
        const assembly = make_assembly([false, true, false, true, true])
        trim_trailing_blanks(assembly)
        expect(assembly.blank_flags).toEqual([false, true, false])
        expect(assembly.pages).toHaveLength(3)
    })

    it('never empties a document entirely', () => {
        const assembly = make_assembly([true, true])
        trim_trailing_blanks(assembly)
        expect(assembly.pages).toHaveLength(1)
    })
})


describe('assemble_reading_preview', () => {

    it('ends a booklet on its pinned last page, padded to the printed sheet', async () => {
        // A booklet reads as a book, but prints on 4-page sheets, so the text page lands on 4
        const request = make_request({arrangement: 'booklet', last_item_at_end: true,
            content: [make_title(), make_custom()]})
        const {assembly, reading_request} = await assemble_reading_preview(request, fake_backend())
        expect(reading_request.arrangement).toBe('book')
        expect(read_pages(assembly))
            .toEqual(['title alt-left', 'blank alt-right', 'blank alt-left', 'custom alt-right'])
    })

    it('trims a clipped window\'s trailing blanks rather than inventing an ending', async () => {
        // A recto title with a blank back would otherwise end on that blank
        const request = make_request({arrangement: 'book', preview_clipped: true,
            titlepage: {...TEST_TITLEPAGE, blank_back: true}, content: [make_title()]})
        const {assembly} = await assemble_reading_preview(request, fake_backend())
        expect(read_pages(assembly)).toEqual(['title alt-left'])
    })
})
