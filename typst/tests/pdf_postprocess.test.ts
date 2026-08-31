
import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import {generate_pdf, generate_pdf_spread_preview, add_preview_strip}
    from '../src/pdf_postprocess.js'
import {make_request, make_passage, make_title, TEST_TITLEPAGE} from './fixtures.js'


// Fake compiler: every source becomes a one-page PDF (with a content stream, since bare empty
// pages can't be embedded by the booklet/spread arrangers)
async function fake_compile(_source:string):Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 200])
    page.drawLine({start: {x: 0, y: 0}, end: {x: 1, y: 1}})
    return doc.save()
}


// Count the pages of generated PDF bytes
async function page_count(bytes:Uint8Array):Promise<number> {
    const doc = await PDFDocument.load(bytes)
    return doc.getPageCount()
}


describe('generate_pdf', () => {

    it('pads booklets to a multiple of 4 for print', async () => {
        // One content page pads to 4, giving 2 two-up sheets
        const request = make_request({arrangement: 'booklet', content: [make_passage()]})
        const bytes = await generate_pdf(request, fake_compile)
        expect(await page_count(bytes)).toBe(2)
    })

    it('only pads booklet previews to even', async () => {
        // One content page pads to 2, giving a single two-up sheet
        const request = make_request({arrangement: 'booklet', content: [make_passage()]})
        const bytes = await generate_pdf(request, fake_compile, undefined, true)
        expect(await page_count(bytes)).toBe(1)
    })

    it('does not pad a title page when titlepage_always is unset', async () => {
        // No forcing at all (the default) — a lone title is just its own 1-page content, no
        // "other side blank" padding either before or after
        const request = make_request({arrangement: 'book', content: [make_title()]})
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(1)
        // Preview still restores evenness for facing-page parity, independent of titlepage_always
        expect(await page_count(await generate_pdf(request, fake_compile, undefined, true)))
            .toBe(2)
    })

    it('forces a title page to start on the right by padding a leading blank', async () => {
        // A single-page passage leaves the page count odd (1); forcing 'right' pads a blank so
        // the title lands on the next recto page — passage(1) + blank(1) + title(1) = 3
        const request = make_request({
            arrangement: 'book',
            content: [make_passage(), make_title()],
            titlepage: {...TEST_TITLEPAGE, always: 'right'},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(3)
    })

    it('forces a title page to start on the left by padding a leading blank', async () => {
        // A lone title as the first item starts at page count 0 (would land recto); forcing
        // 'left' pads a blank first so it starts verso instead — blank(1) + title(1) = 2
        const request = make_request({
            arrangement: 'book',
            content: [make_title()],
            titlepage: {...TEST_TITLEPAGE, always: 'left'},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(2)
    })

})


describe('generate_pdf_spread_preview', () => {

    it('drops trailing blank pages before arranging spreads', async () => {
        // A lone title (1 page, no titlepage_always forcing) previews as a single spread —
        // with no front cover there's no leading slot, so the title pairs onto the left
        const request = make_request({arrangement: 'booklet', content: [make_title()]})
        const bytes = await generate_pdf_spread_preview(request, fake_compile)
        expect(await page_count(bytes)).toBe(1)
    })

    it('prepends the inside-of-cover slot only when the preview has a front cover', async () => {
        // preview_cover_label set (a front cover is shown) — the leading gray slot puts page 1
        // on the right, so a lone 1-page title needs its own spread with a blank right half
        const with_cover = make_request({
            arrangement: 'booklet', content: [make_title()],
            preview_cover_label: 'Inside of cover',
        })
        expect(await page_count(await generate_pdf_spread_preview(with_cover, fake_compile)))
            .toBe(1)
        // 2-page content: with the leading slot that's [slot|p1] + [p2|blank] = 2 spreads,
        // versus [p1|p2] = 1 spread without it
        const two_pages = {arrangement: 'booklet' as const, content: [make_passage(), make_title()]}
        expect(await page_count(await generate_pdf_spread_preview(
            make_request({...two_pages, preview_cover_label: 'Inside of cover'}), fake_compile)))
            .toBe(2)
        expect(await page_count(await generate_pdf_spread_preview(
            make_request(two_pages), fake_compile)))
            .toBe(1)
    })

})


describe('add_preview_strip', () => {

    const TITLE = 'This is only a preview'
    const SUBTITLE = 'Create document to see the finished version'

    it('prepends an 80%-width, short-height page for position "start"', async () => {
        const source = await PDFDocument.create()
        source.addPage([200, 400])
        source.addPage([200, 400])
        const before = await source.save()

        const after = await add_preview_strip(before, '150mm', TITLE, SUBTITLE, 'start')

        const doc = await PDFDocument.load(after)
        expect(doc.getPageCount()).toBe(3)
        const strip = doc.getPage(0)
        // 80% of 150mm in points, and much shorter than a real page
        expect(strip.getSize().width).toBeCloseTo(150 * 72 / 25.4 * 0.8, 1)
        expect(strip.getSize().height).toBeLessThan(120)
        // Original pages follow, untouched
        expect(doc.getPage(1).getSize()).toEqual({width: 200, height: 400})
    })

    it('appends the strip as the last page for position "end"', async () => {
        const source = await PDFDocument.create()
        source.addPage([200, 400])
        source.addPage([200, 400])

        const after = await add_preview_strip(
            await source.save(), '150mm', 'End of preview', SUBTITLE, 'end')

        const doc = await PDFDocument.load(after)
        expect(doc.getPageCount()).toBe(3)
        const strip = doc.getPage(2)
        expect(strip.getSize().width).toBeCloseTo(150 * 72 / 25.4 * 0.8, 1)
        expect(strip.getSize().height).toBeLessThan(120)
        // Original pages unchanged and still first
        expect(doc.getPage(0).getSize()).toEqual({width: 200, height: 400})
    })

    it('shrinks the text (and the strip) to fit a narrow page', async () => {
        const wide_src = await PDFDocument.create()
        wide_src.addPage([600, 800])
        const narrow_src = await PDFDocument.create()
        narrow_src.addPage([600, 800])

        const wide = await PDFDocument.load(
            await add_preview_strip(await wide_src.save(), '160mm', TITLE, SUBTITLE, 'start'))
        const narrow = await PDFDocument.load(
            await add_preview_strip(await narrow_src.save(), '70mm', TITLE, SUBTITLE, 'start'))

        // Each strip is 80% of its own page width
        expect(wide.getPage(0).getSize().width).toBeCloseTo(160 * 72 / 25.4 * 0.8, 1)
        expect(narrow.getPage(0).getSize().width).toBeCloseTo(70 * 72 / 25.4 * 0.8, 1)
        // The narrow page forced the type smaller, so its strip is shorter than the wide one's
        expect(narrow.getPage(0).getSize().height).toBeLessThan(wide.getPage(0).getSize().height)
    })

})
