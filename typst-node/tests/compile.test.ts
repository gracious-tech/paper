
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, it, expect} from 'vitest'
import {PDFDocument, PDFDict, PDFName} from 'pdf-lib'

import {compile_pdf, compile_pdf_spread_preview, generate_typst} from '../src/index.js'

import type {TypstRequest, PageConfig, TypographyConfig} from 'paper-bible-typst'
import type {CustomFont} from '../src/index.js'


// Reusable test configs
const TEST_PAGE:PageConfig = {
    width: '148mm',
    height: '210mm',
    margin_top: '15mm',
    margin_bottom: '15mm',
    margin_left: '15mm',
    margin_right: '15mm',
}

const TEST_TYPOGRAPHY:TypographyConfig = {
    font_text: 'serif',
    font_fallbacks: [],
    font_size: '10pt',
    line_height: 1.5,
    justify: true,
    text_color: null,
    font_headings: 'serif',
    font_titles: 'serif',
}

// Helper to make a minimal request
function make_request(overrides:Partial<TypstRequest> = {}):TypstRequest {
    return {
        title: 'Test Bible',
        page: TEST_PAGE,
        typography: TEST_TYPOGRAPHY,
        features: {
            show_chapters: false,
            show_chapters_style: 'divider',
            show_verses: true,
            show_wj: false,
            show_wj_color: null,
            show_wj_bold: false,
            show_wj_italic: false,
        },
        content: [{
            type: 'passage',
            bibles: [{content: '#vn(1)In the beginning God created the heavens and the earth.'}],
            multi_layout: 'columns',
            half_blank: null,
            show_headings: false,
            show_footnotes: false,
            show_lines: false,
            columns: 1,
            column_gap: '5mm',
            book: 'gen',
            passage_title: null,
            alone: false,
        }],
        arrangement: 'normal',
        show_pages: false,
        booklet_portrait: false,
        ...overrides,
    }
}


describe('compile_pdf', () => {

    it('compiles a simple passage to valid PDF', async () => {
        const result = await compile_pdf(make_request())
        // Should be a Uint8Array starting with PDF header
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result.length).toBeGreaterThan(100)
        // Check PDF magic bytes
        const header = new TextDecoder().decode(result.slice(0, 5))
        expect(header).toBe('%PDF-')
    }, 15000)

    it('produces a single-page PDF for short content', async () => {
        const result = await compile_pdf(make_request())
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
    }, 15000)

    it('sets PDF title metadata', async () => {
        const result = await compile_pdf(make_request({title: 'My Custom Title'}))
        const doc = await PDFDocument.load(result)
        expect(doc.getTitle()).toBe('My Custom Title')
    }, 15000)

    it('sets PDF producer metadata', async () => {
        const result = await compile_pdf(make_request())
        const doc = await PDFDocument.load(result)
        expect(doc.getProducer()).toBe('paper.bible')
    }, 15000)

    it('compiles a title page', async () => {
        const result = await compile_pdf(make_request({
            content: [{
                type: 'title',
                title: 'Holy Bible',
                subtitle: 'ESV',
                icon: null,
                pattern_svg: null,
                color_primary: '#333333',
                color_secondary: '#666666',
                alone: false,
            }],
        }))
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
    }, 15000)

    it('compiles a custom page', async () => {
        const result = await compile_pdf(make_request({
            content: [{
                type: 'custom',
                content: 'Copyright notice goes here.',
                position: 'bottom',
            }],
        }))
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
    }, 15000)

    it('compiles a lines page', async () => {
        const result = await compile_pdf(make_request({
            content: [{type: 'lines', spacing: '10mm'}],
        }))
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
    }, 15000)

    it('compiles multiple content items', async () => {
        const result = await compile_pdf(make_request({
            content: [
                {
                    type: 'passage',
                    bibles: [{content: 'Passage content here.'}],
                    multi_layout: 'columns',
                    half_blank: null,
                    show_headings: false,
                    show_footnotes: false,
                    show_lines: false,
                    columns: 1,
                    column_gap: '5mm',
                    book: 'gen',
                    passage_title: null,
                    alone: false,
                },
                {
                    type: 'custom',
                    content: 'Second page content.',
                    position: 'top' as const,
                },
            ],
        }))
        const doc = await PDFDocument.load(result)
        // Should have at least 2 pages (one per content item)
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
    }, 15000)

    it('respects page dimensions', async () => {
        const result = await compile_pdf(make_request({
            page: {
                ...TEST_PAGE,
                width: '100mm',
                height: '150mm',
            },
        }))
        const doc = await PDFDocument.load(result)
        const page = doc.getPage(0)
        const {width, height} = page.getSize()
        // Convert mm to points (1mm = 2.8346pt)
        const expected_w = 100 * 2.8346
        const expected_h = 150 * 2.8346
        expect(width).toBeCloseTo(expected_w, 0)
        expect(height).toBeCloseTo(expected_h, 0)
    }, 15000)
})


describe('custom_fonts', () => {

    // A real downloaded font, reused as a custom-font fixture (its actual family is "Bevan",
    // read via typst-fonts' own parse_font_family in the test below) — not checked into git
    // (see /fonts/ in .gitignore), so these tests skip rather than fail where it's absent
    // (e.g. a fresh clone before .bin/download_fonts has run)
    const fixture_path = join(import.meta.dirname, '../../fonts/Bevan/Bevan-Regular.ttf')
    const has_fixture = existsSync(fixture_path)

    it.skipIf(!has_fixture)('embeds an uploaded font actually used as the body font', async () => {
        const data = new Uint8Array(await readFile(fixture_path))
        const custom_fonts:CustomFont[] = [{family: 'Bevan', style: 'serif', files: [data]}]
        const result = await compile_pdf(make_request({
            typography: {...TEST_TYPOGRAPHY, font_text: 'Bevan'},
        }), {custom_fonts})
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
        // Typst PDFs pack most objects (including font dicts) into compressed object streams,
        // so a raw-byte search for "Bevan" won't find it — walk pdf-lib's parsed (decompressed)
        // indirect objects instead and check for a BaseFont matching the uploaded family
        // (subsetted fonts get a 6-letter tag prefix, e.g. "UESATU+Bevan-Regular")
        const base_fonts:string[] = []
        for (const [, obj] of doc.context.enumerateIndirectObjects()) {
            if (obj instanceof PDFDict) {
                const base_font = obj.get(PDFName.of('BaseFont'))
                if (base_font)
                    base_fonts.push(base_font.toString())
            }
        }
        expect(base_fonts.some(name => name.includes('Bevan'))).toBe(true)
    }, 15000)

    it('does not break compilation when an unused custom font is supplied', async () => {
        // A synthetic, non-glyph-bearing "font" the real typst binary can't actually use for
        // rendering — proves the --font-path plumbing (temp dir write/cleanup, arg construction)
        // doesn't itself break a compile, independent of whether the bytes are a real font
        const custom_fonts:CustomFont[] = [{
            family: 'Not A Real Font', style: 'serif',
            files: [new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
        }]
        const result = await compile_pdf(make_request(), {custom_fonts})
        const doc = await PDFDocument.load(result)
        expect(doc.getPageCount()).toBe(1)
    }, 15000)
})


describe('compile_pdf_spread_preview', () => {

    // A passage long enough to span several pages
    const long_passage = {
        type: 'passage' as const,
        bibles: [{content: Array.from({length: 20}, (_, i) =>
            `#vn(${i + 1})Verse ${i + 1} with text long enough to wrap onto several lines and `
            + `flow across multiple pages of the document.`).join(' ')}],
        multi_layout: 'columns' as const,
        half_blank: null,
        show_headings: false,
        show_footnotes: false,
        show_lines: false,
        columns: 1,
        column_gap: '5mm',
        book: 'gen',
        passage_title: null,
        alone: false,
    }

    it('lays out spreads as 2-up landscape pages (twice the page width)', async () => {
        const result = await compile_pdf_spread_preview(make_request({
            content: [long_passage], arrangement: 'book',
        }))
        const doc = await PDFDocument.load(result)
        const {width, height} = doc.getPage(0).getSize()
        const page_w = 148 * 2.8346
        const page_h = 210 * 2.8346
        // Each spread is one landscape page holding two portrait pages side by side
        expect(width).toBeCloseTo(page_w * 2, 0)
        expect(height).toBeCloseTo(page_h, 0)
    }, 15000)

    it('produces one spread per pair of pages, with a leading blank page', async () => {
        const request = make_request({content: [long_passage], arrangement: 'book'})
        // Reading-order page count from a plain book compile
        const reading = await PDFDocument.load(await compile_pdf(request))
        const n = reading.getPageCount()
        // Spread count accounts for the prepended blank (n + 1 slots, paired)
        const spreads = await PDFDocument.load(await compile_pdf_spread_preview(request))
        expect(spreads.getPageCount()).toBe(Math.ceil((n + 1) / 2))
    }, 15000)

    it('includes note pages so half-blank spreads pair content with blanks', async () => {
        // half_blank adds blank note pages; spread count must grow to include them
        const plain = make_request({content: [long_passage], arrangement: 'book'})
        const with_notes = make_request({
            content: [{...long_passage, half_blank: 'right' as const}], arrangement: 'book',
        })
        const a = await PDFDocument.load(await compile_pdf_spread_preview(plain))
        const b = await PDFDocument.load(await compile_pdf_spread_preview(with_notes))
        expect(b.getPageCount()).toBeGreaterThan(a.getPageCount())
    }, 15000)
})


describe('generate_typst (re-export)', () => {

    it('is available from typst-node', () => {
        expect(typeof generate_typst).toBe('function')
    })

    it('generates valid Typst source', () => {
        const result = generate_typst(make_request())
        expect(result).toContain('#set page(')
        expect(result).toContain('#set text(')
    })
})
