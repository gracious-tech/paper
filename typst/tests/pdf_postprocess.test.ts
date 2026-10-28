
import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import {generate_pdf} from '../src/pdf_postprocess.js'
import {make_request, make_passage, make_title, make_custom, TEST_TITLEPAGE} from './fixtures.js'


// Fake compiler: every source becomes a one-page PDF (with a content stream, since bare empty
// pages can't be embedded by the booklet/spread arrangers)
async function fake_compile(_source:string):Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([100, 200])
    page.drawLine({start: {x: 0, y: 0}, end: {x: 1, y: 1}})
    return doc.save()
}


// Markup only the pinned text page carries, and the page height marking_compile gives it —
// every other page keeps the standard 200, so a document's page heights say exactly where the
// pinned page ended up
const PINNED_TEXT = 'PINNED-TEXT'
const PINNED_HEIGHT = 300


// As fake_compile, but the source carrying PINNED_TEXT compiles to `pinned_pages` taller pages.
// More than one exercises place_last_item's recompile (its first compile assumes a single page)
function marking_compile(pinned_pages = 1) {
    return async (source:string):Promise<Uint8Array> => {
        const doc = await PDFDocument.create()
        const marked = source.includes(PINNED_TEXT)
        for (let i = 0; i < (marked ? pinned_pages : 1); i++) {
            const page = doc.addPage([100, marked ? PINNED_HEIGHT : 200])
            page.drawLine({start: {x: 0, y: 0}, end: {x: 1, y: 1}})
        }
        return doc.save()
    }
}


// Count the pages of generated PDF bytes
async function page_count(bytes:Uint8Array):Promise<number> {
    const doc = await PDFDocument.load(bytes)
    return doc.getPageCount()
}


// Every page's height, in order (see PINNED_HEIGHT)
async function page_heights(bytes:Uint8Array):Promise<number[]> {
    const doc = await PDFDocument.load(bytes)
    return doc.getPages().map(page => page.getHeight())
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

    it('pads a blank after a right-hand title page when blank_back is set', async () => {
        // passage(1) + forced-right blank(1) + title(1) + blank back(1) + passage(1) = 5, with
        // the second passage starting recto again
        const request = make_request({
            arrangement: 'book',
            content: [make_passage(), make_title(), make_passage()],
            titlepage: {...TEST_TITLEPAGE, always: 'right', blank_back: true},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(5)
    })

    it('pads two blanks before a left-hand title page when blank_back is set', async () => {
        // passage(1) leaves the next page verso, but its recto has content — so two blanks keep
        // the title verso with an empty recto behind it: passage + blank + blank + title = 4
        const request = make_request({
            arrangement: 'book',
            content: [make_passage(), make_title()],
            titlepage: {...TEST_TITLEPAGE, always: 'left', blank_back: true},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(4)
    })

    it('reuses the side-forcing blank as the back of a left-hand title page', async () => {
        // A lone title is forced verso by one leading blank, which is already its back — no more
        // padding before it, and none after since it isn't recto: blank + title = 2
        const request = make_request({
            arrangement: 'book',
            content: [make_title()],
            titlepage: {...TEST_TITLEPAGE, always: 'left', blank_back: true},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(2)
    })

    it('keeps the back blank whichever side an unforced title page lands on', async () => {
        // title(1, recto) + blank back(1) + passage(1, recto) + 2 blanks + title(1, verso) = 6
        const request = make_request({
            arrangement: 'book',
            content: [make_title(), make_passage(), make_title()],
            titlepage: {...TEST_TITLEPAGE, always: null, blank_back: true},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(6)
    })

    it('skips the blank back when printing single-sided', async () => {
        // 'normal' arrangement has no other side, so neither blank is inserted — title + passage
        const request = make_request({
            arrangement: 'normal',
            content: [make_title(), make_passage()],
            titlepage: {...TEST_TITLEPAGE, always: 'right', blank_back: true},
        })
        expect(await page_count(await generate_pdf(request, fake_compile))).toBe(2)
    })

})


describe('facing pages and portrait booklets', () => {

    // Facing passages compile at double width; everything else as fake_compile does
    async function facing_compile(source:string):Promise<Uint8Array> {
        const doc = await PDFDocument.create()
        const wide = source.includes('width: 2 * ')
        for (let i = 0; i < (wide ? 2 : 1); i++) {
            const page = doc.addPage([wide ? 200 : 100, 200])
            page.drawLine({start: {x: 0, y: 0}, end: {x: 1, y: 1}})
        }
        return doc.save()
    }

    it('cuts each double-width page of a facing passage into two pages', async () => {
        const passage = make_passage({
            bibles: [{content: '#vn(1)NIV'}, {content: '#vn(1)ESV'}],
            multi_layout: 'alternate',
        })
        const bytes = await generate_pdf(make_request({content: [passage]}), facing_compile)
        const doc = await PDFDocument.load(bytes)
        expect(doc.getPages().map(page => [page.getWidth(), page.getHeight()]))
            .toEqual([[100, 200], [100, 200], [100, 200], [100, 200]])
    })

    // Fronts turn 90°, backs 270°, baking in the short-edge flip for long-edge duplexing
    it('rotates a portrait booklet\'s sheets, backs the other way round', async () => {
        const request = make_request({arrangement: 'booklet', booklet_portrait: true,
            content: [make_passage()]})
        const doc = await PDFDocument.load(await generate_pdf(request, fake_compile))
        expect(doc.getPages().map(page => page.getRotation().angle)).toEqual([90, 270])
    })

    it('leaves a landscape booklet\'s sheets unrotated', async () => {
        const request = make_request({arrangement: 'booklet', content: [make_passage()]})
        const doc = await PDFDocument.load(await generate_pdf(request, fake_compile))
        expect(doc.getPages().map(page => page.getRotation().angle)).toEqual([0, 0])
    })

})


describe('last_item_at_end', () => {

    // The text page to land on the document's final page (a copyright notice, in practice)
    const pinned_text = () => make_custom({content: PINNED_TEXT})

    it('puts the padding blank before the pinned text page rather than after it', async () => {
        // 2 passage pages + the text page = 3, padded to an even 4 for the preview
        const request = make_request({
            arrangement: 'book', last_item_at_end: true,
            content: [make_passage(), make_passage(), pinned_text()],
        })
        const heights = await page_heights(
            await generate_pdf(request, marking_compile(), undefined, true))
        expect(heights).toEqual([200, 200, 200, PINNED_HEIGHT])
    })

    it('leaves the padding blank after the text page when unset', async () => {
        const request = make_request({
            arrangement: 'book',
            content: [make_passage(), make_passage(), pinned_text()],
        })
        const heights = await page_heights(
            await generate_pdf(request, marking_compile(), undefined, true))
        expect(heights).toEqual([200, 200, PINNED_HEIGHT, 200])
    })

    it('ends a multi-page pinned item on the last page', async () => {
        // 1 passage page + a 2-page text item: it starts on page 3 and finishes on page 4,
        // which only works because place_last_item recompiles it at its corrected start page
        const request = make_request({
            arrangement: 'book', last_item_at_end: true,
            content: [make_passage(), pinned_text()],
        })
        const heights = await page_heights(
            await generate_pdf(request, marking_compile(2), undefined, true))
        expect(heights).toEqual([200, 200, PINNED_HEIGHT, PINNED_HEIGHT])
    })

    it('never changes a printed booklet page count', async () => {
        // 4 passage pages + the text page pads to 8 either way — pinning only moves the blanks
        const content = [make_passage(), make_passage(), make_passage(), make_passage(),
            pinned_text()]
        const pinned = make_request({arrangement: 'booklet', last_item_at_end: true, content})
        const plain = make_request({arrangement: 'booklet', content})
        expect(await page_count(await generate_pdf(pinned, fake_compile))).toBe(4)
        expect(await page_count(await generate_pdf(plain, fake_compile))).toBe(4)
    })

    it('ignores the setting when the last item is not a text page', async () => {
        // A passage can run to any length, so pinning one would shift the blanks into the
        // middle of the book rather than off its end (see pin_last_item)
        const request = make_request({
            arrangement: 'book', last_item_at_end: true,
            content: [pinned_text(), make_passage(), make_passage()],
        })
        const heights = await page_heights(
            await generate_pdf(request, marking_compile(), undefined, true))
        expect(heights).toEqual([PINNED_HEIGHT, 200, 200, 200])
    })

})
