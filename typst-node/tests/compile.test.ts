
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, it, expect} from 'vitest'
import {PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef} from 'pdf-lib'

import {compile_pdf, compile_svg_preview, generate_typst} from '../src/index.js'

import type {TypstRequest, PageConfig, TypographyConfig, TitlepageConfig} from 'paper-bible-typst'
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
    font_text2: 'serif',
    font_fallbacks: [],
    font_fallbacks2: [],
    font_size: '10pt',
    footnote_size: '8.5pt',
    lang: 'en',
    lang2: null,
    dir: 'ltr',
    dir2: null,
    notes_lang: null,
    notes_dir: null,
    line_height: 1.5,
    justify: true,
    hyphenate: true,
    poetry_outdent: true,
    text_color: null,
    font_headings: 'serif',
    font_headings2: 'serif',
}

const TEST_TITLEPAGE:TitlepageConfig = {
    font: 'serif',
    frame_svg: null,
    color_text: '#333333',
    color_frame: '#666666',
    text_size: 1,
    icon_size: 1,
    always: null,
    blank_back: false,
}

// Helper to make a minimal request
function make_request(overrides:Partial<TypstRequest> = {}):TypstRequest {
    return {
        title: 'Test Bible',
        page: TEST_PAGE,
        typography: TEST_TYPOGRAPHY,
        titlepage: TEST_TITLEPAGE,
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
            headings_bold: true,
            headings_italic: true,
            headings_size: 0.9,
            show_footnotes: false,
            lines: null,
            columns: 1,
            column_gap: '5mm',
            book: 'gen',
            book_name: 'Genesis',
            start_chapter: 1,
            passage_title: null,
            passage_subtitle: null,
            passage_icon: null,
        }],
        arrangement: 'normal',
        running_pages: false,
        running_headings: false,
        running_position: 'footer',
        running_align: 'center',
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
        // updateMetadata: false — pdf-lib's own load() otherwise unconditionally resets
        // Producer to its own default, clobbering the value being asserted on here
        const doc = await PDFDocument.load(result, {updateMetadata: false})
        expect(doc.getProducer()).toBe('paper.bible')
    }, 15000)

    it('compiles a title page', async () => {
        const result = await compile_pdf(make_request({
            content: [{
                type: 'title',
                title: 'Holy Bible',
                subtitle: 'ESV',
                icon: null,
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
                    headings_bold: true,
                    headings_italic: true,
                    headings_size: 0.9,
                    show_footnotes: false,
                    lines: null,
                    columns: 1,
                    column_gap: '5mm',
                    book: 'gen',
                    book_name: 'Genesis',
                    start_chapter: 1,
                    passage_title: null,
                    passage_subtitle: null,
                    passage_icon: null,
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

    it('deduplicates font subsets duplicated by multi-compile assembly', async () => {
        // A booklet compiles each content item separately, then merges and imposes with
        // pdf-lib — which re-copies each compile's font subsets for every page copy/embed.
        // Two identical passages produce byte-identical subsets, so after optimize_pdf the
        // document must hold exactly one font program stream, shared by all descriptors
        const passage = make_request().content[0]!
        const result = await compile_pdf(make_request({
            arrangement: 'booklet',
            content: [passage, passage],
        }))
        const doc = await PDFDocument.load(result)

        // Collect the font program streams referenced by every font descriptor
        const refs = new Set<string>()
        const bytes:string[] = []
        for (const [, obj] of doc.context.enumerateIndirectObjects()) {
            if (!(obj instanceof PDFDict)
                    || obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') {
                continue
            }
            for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
                const ref = obj.get(PDFName.of(key))
                if (!(ref instanceof PDFRef) || refs.has(ref.toString())) {
                    continue
                }
                refs.add(ref.toString())
                const stream = doc.context.lookup(ref)
                if (stream instanceof PDFRawStream) {
                    bytes.push(Buffer.from(stream.getContents()).toString('base64'))
                }
            }
        }
        expect(bytes.length).toBeGreaterThan(0)
        // No two remaining font program streams may be byte-identical
        expect(new Set(bytes).size).toBe(bytes.length)
    }, 15000)

    it('compiles when a line could hyphenate straight after a footnote marker', async () => {
        // Markers set hard against the next word (as fetch.bible's Reina-Valera does) once made
        // the PDF export fail ("expected link ancestor in logical tree") wherever a justified
        // line hyphenated right after one. Which width breaks there depends on the font, so
        // sweep a range rather than pin one
        const passage = make_request().content[0]!
        const content = '#vn(20)Y ella les respondiá: No me llaméis #footnote[Placentera.]Noemi,'
            + ' sino llamadme #footnote[Amarga.]Mara: porque en grande amargura me ha puesto el'
            + ' #footnote[x]Todopoderoso. Llegaron #footnote[y]extraordinariamente'
            + ' #footnote[z]misericordiosamente a la #footnote[w]bienaventuranza y'
            + ' #footnote[v]Bethlehemitas #footnote[u]incomprensiblemente fin.'
        const widths = Array.from({length: 17}, (_, i) => `${90 + i * 5}mm`)
        await Promise.all(widths.map(width => compile_pdf(make_request({
            page: {...TEST_PAGE, width},
            typography: {...TEST_TYPOGRAPHY, lang: 'es'},
            content: [{...passage, show_footnotes: true, bibles: [{content}]}],
        }))))
    }, 60000)
})


describe('custom_fonts', () => {

    // A real downloaded font, reused as a custom-font fixture (its actual family is "Bevan",
    // read via typst-fonts' own parse_font_family in the test below) — the untracked assets/
    // tree comes from the bookcover repo, so these tests skip rather than fail where it's
    // absent (e.g. a fresh clone before assets/ has been linked in)
    const fixture_path = join(import.meta.dirname, '../../assets/fonts/Bevan/Bevan-Regular.ttf')
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


describe('compile_svg_preview', () => {

    it('gives one standalone page per page, in order past the ninth', async () => {
        // Pages of increasing height, so the order they come back in can be read off their
        // sizes — the CLI pads its page numbers once there are ten or more, which a plain
        // string sort of the files would put out of order
        const pages = Array.from({length: 12}, (_, i) =>
            `#page(width: 100pt, height: ${100 + i}pt)[x]`).join('\n')
        const request = make_request({preview_clipped: true, content: [{
            ...make_request().content[0]!, bibles: [{content: pages}]} as TypstRequest['content'][0]]})
        const result = await compile_svg_preview(request)
        const heights = result.map(page => page.height)
        expect(heights.slice(-12)).toEqual(Array.from({length: 12}, (_, i) => 100 + i))
        expect(result[0]!.inner).not.toContain('<svg')
    }, 30000)
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
