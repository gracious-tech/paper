// The phone preview's pages: typst.ts's SVG of a whole document split into standalone pages, and
// the same page assembly print uses (assemble.ts) run over them. A page that loses a glyph
// definition renders with holes where letters were, and one that keeps every definition of its
// document makes a 30-page preview carry each page's glyphs 30 times, so both are pinned here.

import {describe, it, expect} from 'vitest'

import {split_typst_svg, svg_page_half, svg_page_markup, generate_svg_preview}
    from '../src/svg_pages.js'
import {make_request, make_passage, make_title} from './fixtures.js'

import type {SvgPage} from '../src/svg_pages.js'


// A two-page document as typst.ts renders it (abridged from a real render): shared definitions
// first, then each page as a top-level group translated down one tall canvas. Page 1 uses glyph
// A and a gradient that refers to a base gradient; page 2 uses only glyph B
const DOC_SVG = '<svg class="typst-doc" viewBox="0 0 100 280" width="100" height="280"'
    + ' xmlns="http://www.w3.org/2000/svg"><style>.typst-text{}</style>'
    + '<defs class="glyph"><path id="gA" class="outline_glyph" d="M0 0L1 1"/>'
    + '<path id="gB" class="outline_glyph" d="M0 0L2 2"/></defs>'
    + '<defs class="clip-path"><linearGradient id="gBase" x1="0"><stop offset="0%"'
    + ' stop-color="#f00"/></linearGradient></defs><style></style>'
    + '<g class="typst-page" transform="translate(0, 0)" data-tid="p1" data-page-width="100"'
    + ' data-page-height="140"><g data-tid="t1" class="typst-text"><use href="#gA"/>'
    + '<foreignObject x="0"><h5:div class="tsel">Hello</h5:div></foreignObject></g>'
    + '<linearGradient id="gPage" href="#gBase"></linearGradient>'
    + '<path fill="url(#gPage)" d="M0 0"/></g>'
    + '<g class="typst-page" transform="translate(0, 140)" data-tid="p2" data-page-width="100"'
    + ' data-page-height="140"><g data-tid="t2" class="typst-text"><use href="#gB"/></g></g>'
    + '</svg>'


describe('split_typst_svg', () => {

    it('makes one page per page group, sized from its data attributes', () => {
        const pages = split_typst_svg(DOC_SVG)
        expect(pages.map(page => [page.x, page.width, page.height]))
            .toEqual([[0, 100, 140], [0, 100, 140]])
    })

    it('moves each page to the origin', () => {
        for (const page of split_typst_svg(DOC_SVG)){
            expect(page.inner).not.toContain('translate(0, 140)')
            expect(page.inner).not.toContain('typst-page')
        }
    })

    it('gives each page only the definitions it references, followed transitively', () => {
        const [first, second] = split_typst_svg(DOC_SVG)
        expect(first!.inner).toContain('id="gA"')
        expect(first!.inner).toContain('id="gBase"')
        expect(first!.inner).not.toContain('id="gB"')
        expect(second!.inner).toContain('id="gB"')
        expect(second!.inner).not.toContain('id="gA"')
        expect(second!.inner).not.toContain('id="gBase"')
    })

    it('drops the text selection layer and per-node ids', () => {
        const [first] = split_typst_svg(DOC_SVG)
        expect(first!.inner).not.toContain('foreignObject')
        expect(first!.inner).not.toContain('data-tid')
        expect(first!.inner).not.toContain('</svg>')
    })
})


describe('svg_page_markup', () => {

    it('is a standalone SVG sized in points, framing the part of the page shown', () => {
        const page:SvgPage = {inner: '<g/>', x: 0, width: 200, height: 140}
        const right = svg_page_markup(svg_page_half(page, 'right'))
        expect(right).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
        expect(right).toContain('viewBox="100 0 100 140"')
        expect(right).toContain('width="100pt" height="140pt"')
        expect(svg_page_markup(svg_page_half(page, 'left'))).toContain('viewBox="0 0 100 140"')
    })
})


// Fake compiler: every source becomes one page, labelled by whether it's a padding blank (the
// blank page's source sets no content) so the assembled order can be read back
async function fake_compile(source:string):Promise<SvgPage[]> {
    const kind = source.includes('In the beginning') ? 'passage'
        : source.includes('TITLE') ? 'title' : 'other'
    return [{inner: kind, x: 0, width: 100, height: 200}]
}


describe('generate_svg_preview', () => {

    it('pads to the page count the document will really print at', async () => {
        // One page printed as a booklet is a 4-page sheet, and the preview shows all 4
        const request = make_request({arrangement: 'booklet', content: [make_title()]})
        expect(await generate_svg_preview(request, fake_compile)).toHaveLength(4)
    })

    it('leaves a clipped window unpadded', async () => {
        const request = make_request({
            arrangement: 'booklet', content: [make_title()], preview_clipped: true})
        expect(await generate_svg_preview(request, fake_compile)).toHaveLength(1)
    })

    it('shows a facing-pages passage as both halves of each double page, on a verso', async () => {
        const passage = make_passage({multi_layout: 'alternate',
            bibles: [{content: 'In the beginning'}, {content: 'Au commencement'}]})
        const request = make_request({arrangement: 'book', content: [passage],
            preview_clipped: true})
        // The facing passage compiles double-width, everything else (the blanks) single
        const pages = await generate_svg_preview(request, async source =>
            source.includes('Au commencement')
                ? [{inner: 'wide', x: 0, width: 200, height: 200}]
                : [{inner: 'blank', x: 0, width: 100, height: 200}])
        // A blank recto first, so the split pair reads as one open spread
        expect(pages.map(page => [page.inner, page.x, page.width]))
            .toEqual([['blank', 0, 100], ['wide', 0, 100], ['wide', 100, 100]])
    })
})
