
import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import {generate_pdf, generate_pdf_spread_preview} from '../src/pdf_postprocess.js'
import {make_request, make_passage, make_title, make_custom} from './fixtures.js'


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

    it('places preview notice pages around booklet imposition, not inside it', async () => {
        // One content page pads to 2 (preview), giving a single two-up sheet; the notices sit
        // before/after it as natural (single) size pages rather than folding into the pairing
        const request = make_request({
            arrangement: 'booklet', content: [make_passage()],
            preview_front: make_custom(), preview_rear: make_custom(),
        })
        const bytes = await generate_pdf(request, fake_compile, undefined, true)
        const doc = await PDFDocument.load(bytes)
        expect(doc.getPageCount()).toBe(3)
        expect(doc.getPage(0).getSize().width).toBe(100)
        expect(doc.getPage(1).getSize().width).toBe(200)
        expect(doc.getPage(2).getSize().width).toBe(100)
    })

    it('adds preview notice pages sequentially for non-booklet arrangements', async () => {
        // Book arrangement reads in order, so the rear notice just becomes the last content
        // page (1 content + 1 notice = 2 pages, already even)
        const request = make_request({
            arrangement: 'book', content: [make_passage()], preview_rear: make_custom(),
        })
        const bytes = await generate_pdf(request, fake_compile, undefined, true)
        expect(await page_count(bytes)).toBe(2)
    })

    it('trims trailing blanks from book previews but keeps the count even', async () => {
        // An alone title gets a blank rear: kept for print, but a preview trims it and then
        // restores evenness — so both end up at 2 pages, while content stays 1 page
        const request = make_request({arrangement: 'book', content: [make_title()]})
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(2)
        expect(await page_count(await generate_pdf(request, fake_compile, undefined, true)))
            .toBe(2)
    })

})


describe('generate_pdf_spread_preview', () => {

    it('drops trailing blank pages before arranging spreads', async () => {
        // An alone title (1 page + blank rear) previews as a single spread — the leading blank
        // slot puts the title on the right and the trailing blank is trimmed entirely
        const request = make_request({arrangement: 'booklet', content: [make_title()]})
        const bytes = await generate_pdf_spread_preview(request, fake_compile)
        expect(await page_count(bytes)).toBe(1)
    })

    it('places preview notice pages as the first and last spread pages', async () => {
        // Front notice + passage + rear notice read sequentially: leading blank slot + 3
        // pages = 2 spreads
        const request = make_request({
            arrangement: 'booklet', content: [make_passage()],
            preview_front: make_custom(), preview_rear: make_custom(),
        })
        const bytes = await generate_pdf_spread_preview(request, fake_compile)
        expect(await page_count(bytes)).toBe(2)
    })

})
