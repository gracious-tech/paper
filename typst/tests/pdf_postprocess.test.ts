
import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import {generate_pdf, generate_pdf_spread_preview, add_preview_strip, gen_preview_strip_typst,
    gen_cover_slot_typst, notice_fonts}
    from '../src/pdf_postprocess.js'
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

    it('pads a pinned document to the printed length in the spread preview', async () => {
        // 1 passage page + the text page prints as a 4-page booklet either way — pinning only
        // decides whether the 2 blanks fall before the text page or after it, which the spread
        // preview can't be asked about directly (the page order above covers that), so this
        // just holds place_last_item to the same total the unpinned path pads to
        const content = [make_passage(), pinned_text()]
        const pinned = make_request({arrangement: 'booklet', last_item_at_end: true, content})
        const plain = make_request({arrangement: 'booklet', content})
        expect(await page_count(await generate_pdf_spread_preview(pinned, fake_compile))).toBe(3)
        expect(await page_count(await generate_pdf_spread_preview(plain, fake_compile))).toBe(3)
    })

})


describe('generate_pdf_spread_preview', () => {

    it('pads out to the page count the document will really print at', async () => {
        // A lone title (1 page, no titlepage_always forcing) prints as a 4-page booklet, so the
        // preview shows all 4: page 1 standalone (no front cover), then [2|3] and [4|gray pad]
        const request = make_request({arrangement: 'booklet', content: [make_title()]})
        const bytes = await generate_pdf_spread_preview(request, fake_compile)
        expect(await page_count(bytes)).toBe(3)
    })

    it('leaves a clipped window unpadded', async () => {
        // Content past the window was dropped, so its last page isn't the document's last —
        // padding it would invent an ending this preview has no business showing
        const request = make_request({
            arrangement: 'booklet', content: [make_title()], preview_clipped: true})
        const bytes = await generate_pdf_spread_preview(request, fake_compile)
        expect(await page_count(bytes)).toBe(1)
    })

    it('stands the first and last pages alone when there is no front cover', async () => {
        // Without a cover neither the front nor the back has an inside face to show a page
        // against, so both outermost pages are emitted standalone at single width and the
        // full-width spreads run between them: 1, then [2|3], then 4
        const doc = await PDFDocument.load(await generate_pdf_spread_preview(
            make_request({arrangement: 'booklet', content: [make_passage(), make_title()]}),
            fake_compile))
        expect(doc.getPageCount()).toBe(3)
        expect(doc.getPage(0).getWidth()).toBe(100)
        expect(doc.getPage(1).getWidth()).toBe(200)
        expect(doc.getPage(2).getWidth()).toBe(100)
    })

    it('prepends the inside-of-cover slot only when the preview has a front cover', async () => {
        // preview_cover_label set (a front cover is shown) — the leading gray slot puts page 1
        // on the right of a full-width first spread, rather than standing alone at half width
        // as it does without a cover (see the test above, same content)
        const content = [make_passage(), make_title()]
        const with_cover = make_request({
            arrangement: 'booklet', content, preview_cover_label: 'Inside of cover'})
        const doc = await PDFDocument.load(
            await generate_pdf_spread_preview(with_cover, fake_compile))
        expect(doc.getPage(0).getWidth()).toBe(200)
        // [slot|1] [2|3] [4|slot] — every page is a spread, the trailing gray slot being the
        // inside of the back cover (which is a real surface here, unlike the test above)
        expect(doc.getPageCount()).toBe(3)
        expect(doc.getPage(2).getWidth()).toBe(200)
    })

    it('draws the compiled cover slot into the first spread when given one', async () => {
        // The labelled slot comes typeset from gen_cover_slot_typst (the browser compiles it);
        // without one the slot is a plain gray fill, so the slot's page adds to the output
        const request = make_request({arrangement: 'booklet', content: [make_passage()],
            preview_cover_label: 'Inside of cover'})
        const slot = await PDFDocument.create()
        slot.addPage([100, 200]).drawText('Inside of cover')
        const plain = await generate_pdf_spread_preview(request, fake_compile)
        const labelled = await generate_pdf_spread_preview(request, fake_compile, undefined,
            await slot.save())
        expect((await PDFDocument.load(labelled)).getPageCount())
            .toBe((await PDFDocument.load(plain)).getPageCount())
        expect(labelled.length).toBeGreaterThan(plain.length)
    })

})


describe('add_preview_strip', () => {

    // A compiled strip stands in for gen_preview_strip_typst's output: one short wide page
    const make_strip = async () => {
        const strip = await PDFDocument.create()
        strip.addPage([340, 60])
        return strip.save()
    }

    const make_book = async () => {
        const source = await PDFDocument.create()
        source.addPage([200, 400])
        source.addPage([200, 400])
        return source.save()
    }

    it('prepends the strip as page 1 for position "start"', async () => {
        const doc = await PDFDocument.load(
            await add_preview_strip(await make_book(), await make_strip(), 'start'))
        expect(doc.getPageCount()).toBe(3)
        expect(doc.getPage(0).getSize()).toEqual({width: 340, height: 60})
        // Original pages follow, untouched
        expect(doc.getPage(1).getSize()).toEqual({width: 200, height: 400})
    })

    it('appends the strip as the last page for position "end"', async () => {
        const doc = await PDFDocument.load(
            await add_preview_strip(await make_book(), await make_strip(), 'end'))
        expect(doc.getPageCount()).toBe(3)
        expect(doc.getPage(2).getSize()).toEqual({width: 340, height: 60})
        expect(doc.getPage(0).getSize()).toEqual({width: 200, height: 400})
    })
})


describe('gen_preview_strip_typst', () => {

    const fonts = ['Base', 'Noto Sans Arabic']
    const source = (title:string, locale = 'eng', dir:'ltr'|'rtl' = 'ltr') =>
        gen_preview_strip_typst('150mm', title, 'Subtitle', locale, dir, fonts)

    it('is 80% of the page wide and only as tall as its text', () => {
        expect(source('Title')).toContain('#set page(width: 150mm * 0.8, height: auto')
    })

    it('typesets in the given fonts, language and direction', () => {
        const out = source('هذه معاينة فقط', 'ara', 'rtl')
        expect(out).toContain('font: ("Base", "Noto Sans Arabic")')
        expect(out).toContain('lang: "ar", dir: rtl')
    })

    it('reads the language from a locale with a script subtag', () => {
        expect(source('预览', 'zho-Hant')).toContain('lang: "zh"')
    })

    it('escapes its text for Typst markup', () => {
        expect(source('#1 [preview]')).toContain('\\#1 \\[preview\\]')
    })
})


describe('gen_cover_slot_typst', () => {

    it('is a gray page the size of the book\'s, labelled in the middle', () => {
        const out = gen_cover_slot_typst({width: '148mm', height: '210mm'}, 'Mặt trong bìa',
            ['Base'])
        expect(out).toContain('#set page(width: 148mm, height: 210mm')
        expect(out).toContain('#align(center + horizon)[Mặt trong bìa]')
    })
})


describe('notice_fonts', () => {

    it('adds the Noto family a script needs', () => {
        expect(notice_fonts('هذه معاينة فقط')).toEqual(['Noto Sans Arabic'])
    })

    it('needs nothing beyond the base font for Latin text, accents included', () => {
        expect(notice_fonts('Đây chỉ là bản xem trước')).toEqual([])
    })
})
