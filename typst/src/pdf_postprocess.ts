
import {PDFDocument, PDFPage, degrees, rgb} from 'pdf-lib'
import {escape_typst_str} from 'typst-utils'
import {resolve_fallback_chain, detect_cjk_variant} from 'typst-fonts'

import {assemble_pages, assemble_reading_preview, trim_trailing_blanks, pin_last_item,
    pad_multiple, pad_pages, place_last_item} from './assemble.js'
import {optimize_pdf} from './pdf_optimize.js'
import {escape_typst} from './helpers.js'
import {resolve_lang} from './lang.js'

import type {Assembly, PageBackend} from './assemble.js'
import type {CoverPageGeometry} from './cover.js'
import type {TypstRequest, CompileFn, ProgressFn, TextDir} from './types.js'


// Fill color for a spread-preview slot that isn't a real page (see arrange_spreads) — a subtle
// gray so it reads as "not printed" rather than a blank printed page
const NOT_A_PAGE_FILL = rgb(0.9, 0.9, 0.9)


// The assembly backend for print: each compiled source is a pdf-lib document (see assemble.ts)
function pdf_backend(compile_fn:CompileFn):PageBackend<PDFDocument> {
    return {
        compile: async (source, assets) => await PDFDocument.load(await compile_fn(source, assets)),
        page_count: doc => doc.getPageCount(),
        split_halves: split_facing,
    }
}


// Copy an assembled page sequence into one PDF, in order
async function materialize_pdf(assembly:Assembly<PDFDocument>):Promise<PDFDocument> {
    const out = await PDFDocument.create()
    for (const {doc, index} of assembly.pages) {
        const [page] = await out.copyPages(doc, [index])
        out.addPage(page as PDFPage)
    }
    return out
}


// Full pipeline: generate Typst source(s), compile via provided function, assemble and
// post-process the PDF. Handles alternate interleaving, half-blank, booklet imposition.
// preview relaxes the print-only padding rules: trailing blank pages are dropped and page
// counts are only kept even (rather than booklet-padded to a multiple of 4), since a screen
// preview only needs recto/verso parity to read correctly.
export async function generate_pdf(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn, preview = false,
):Promise<Uint8Array> {

    // Assemble the printed page sequence (each section compiled separately, see assemble.ts),
    // then arrange for print. A pinned final item is held back from the assembly and placed
    // afterwards, once the padded length it has to land at the end of is known
    const backend = pdf_backend(compile_fn)
    const pinned = pin_last_item(request)
    const assembly = await assemble_pages(request, backend, on_progress, !!pinned)

    // Previews drop the run of blank pages at the very end — they carry no information on
    // screen (evenness is restored below where it matters)
    if (preview) {
        trim_trailing_blanks(assembly)
    }

    if (pinned) {
        await place_last_item(assembly, request, backend, pinned,
            pad_multiple(request.arrangement, preview))
    }

    if (request.arrangement === 'booklet') {
        on_progress?.({stage: 'arrange', label: 'booklet'})
        on_progress?.({stage: 'finalize'})
        // A physical folded sheet holds 4 pages. Previews aren't printed, so they only pad to
        // even — just enough for the 2-up pairing
        pad_pages(assembly, preview ? 2 : 4)
        return await apply_booklet(await materialize_pdf(assembly), request)
    }

    // Keep a trimmed book preview even so facing-page parity still reads correctly
    if (preview && request.arrangement === 'book') {
        pad_pages(assembly, 2)
    }

    on_progress?.({stage: 'finalize'})
    const pdf_bytes = await (await materialize_pdf(assembly)).save()
    return apply_metadata(pdf_bytes, request)
}


// Preview pipeline: lay out the printed pages as facing-page book spreads, as if the book
// were opened. With a front cover, page 1 sits on the right of the first spread beside a gray
// "inside of cover" slot; without one, page 1 stands alone on its own half-width page (a book
// opens on a recto). Then 2|3, 4|5, etc. Includes every blank/note page exactly as printed.
// For on-screen preview only, never for printing.
export async function generate_pdf_spread_preview(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn,
    cover_slot?:Uint8Array,
):Promise<Uint8Array> {
    const {assembly, reading_request} = await assemble_reading_preview(
        request, pdf_backend(compile_fn), on_progress)
    on_progress?.({stage: 'arrange', label: 'spreads'})
    on_progress?.({stage: 'finalize'})
    return await arrange_spreads(await materialize_pdf(assembly), reading_request, cover_slot)
}


// Arrange a reading-order document into facing-page spreads: pages shown two-up side by side
// as if the book were open. Each spread is one landscape page (2x width) with the two pages
// drawn left and right (same 2-up technique as apply_booklet).
//
// With a front cover (request.preview_cover_label is set for exactly that case), a leading gray
// slot — the inside face of the cover — is prepended so page 1 lands on the right of the first
// spread, and a trailing one closes it off as the inside face of the back cover. The leading one
// is `cover_slot` when given (gen_cover_slot_typst, compiled — it carries the label); otherwise,
// and for any other slot, a plain gray fill. Without a
// cover there are no such faces, so the first page (and the last, when nothing faces it) is
// emitted on its own single-width page instead, and the full-width spreads run between them.
async function arrange_spreads(
    reading_doc:PDFDocument, request:TypstRequest, cover_slot?:Uint8Array,
):Promise<Uint8Array> {

    const total = reading_doc.getPageCount()
    if (total === 0) {
        return await reading_doc.save()
    }

    const spread_doc = await PDFDocument.create()
    const {width: page_w, height: page_h} = reading_doc.getPage(0).getSize()

    // The CLI/server compile path never sets preview_cover_label (it has no i18n to translate it
    // with), and only the browser compiles a labelled slot to go with it
    const has_cover = !!request.preview_cover_label
    const slot_page = has_cover && cover_slot
        ? (await spread_doc.embedPdf(cover_slot, [0]))[0]!
        : null

    // Slot order for the spreads. With a cover: a leading gray slot (inside of front cover) so
    // page 1 lands on the right, then every page in reading order. Without one: skip page 1
    // (emitted standalone below) and start the spreads at page 2.
    const slots:(number|null)[] = has_cover ? [null] : []
    for (let p = has_cover ? 0 : 1; p < total; p++) {
        slots.push(p)
    }

    // An odd slot count leaves the final page with nothing facing it. With a cover that empty
    // half is a real surface — the inside of the back cover — so it takes a gray slot like the
    // front one; without a cover there's nothing there at all, so the page stands alone just as
    // page 1 does rather than being shown against a face the book doesn't have
    let trailing_alone:number|null = null
    if (slots.length % 2 === 1) {
        if (has_cover) {
            slots.push(null)
        } else {
            trailing_alone = slots.pop() as number
        }
    }

    // Draw one reading page on a single-width page of its own, for the pages with no facing one
    const add_standalone = async (index:number) => {
        const page = spread_doc.addPage([page_w, page_h])
        const [embed] = await spread_doc.embedPages([reading_doc.getPage(index)])
        page.drawPage(embed!, {x: 0, y: 0, width: page_w, height: page_h})
    }

    // No cover: page 1 opens the preview on its own, ahead of the spreads
    if (!has_cover) {
        await add_standalone(0)
    }

    // Each pair of slots becomes one spread; a null slot isn't a real page (the inside of the
    // front/back cover), so it gets a subtle gray fill instead of matching-white to signal that
    for (let i = 0; i < slots.length; i += 2) {
        const new_page = spread_doc.addPage([page_w * 2, page_h])
        const left_slot = slots[i]
        const right_slot = slots[i + 1]

        if (left_slot != null) {
            const [embed] = await spread_doc.embedPages([reading_doc.getPage(left_slot)])
            new_page.drawPage(embed!, {x: 0, y: 0, width: page_w, height: page_h})
        } else {
            // Only the very first spread's left slot is the front cover's inside face — later
            // null slots (e.g. a trailing pad) aren't, so the label is deliberately not repeated
            if (i === 0 && slot_page) {
                new_page.drawPage(slot_page, {x: 0, y: 0, width: page_w, height: page_h})
            } else {
                new_page.drawRectangle(
                    {x: 0, y: 0, width: page_w, height: page_h, color: NOT_A_PAGE_FILL})
            }
        }
        if (right_slot != null) {
            const [embed] = await spread_doc.embedPages([reading_doc.getPage(right_slot)])
            new_page.drawPage(embed!, {x: page_w, y: 0, width: page_w, height: page_h})
        } else {
            new_page.drawRectangle(
                {x: page_w, y: 0, width: page_w, height: page_h, color: NOT_A_PAGE_FILL})
        }

        // Thin, half-opacity line down the centre seam, dividing the two facing pages
        // (preview only) — subtle rather than a bold rule
        new_page.drawLine({
            start: {x: page_w, y: 0},
            end: {x: page_w, y: page_h},
            thickness: 1,
            color: NOT_A_PAGE_FILL,
        })
    }

    // No cover: the final page closes the preview on its own, mirroring page 1
    if (trailing_alone !== null) {
        await add_standalone(trailing_alone)
    }

    const pdf_bytes = await spread_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Preview strip type sizes (points), the gap between its two lines, and its padding
const PREVIEW_STRIP_TITLE_SIZE = 13
const PREVIEW_STRIP_SUBTITLE_SIZE = 9.5
const PREVIEW_STRIP_LINE_GAP = 6
const PREVIEW_STRIP_PADDING = 11


// The Noto fallback families a preview notice's text needs beyond the base font, by script —
// notices are in the app's UI language, which can be any script whatever the Bible's is
export function notice_fonts(text:string):string[] {
    return resolve_fallback_chain(text, detect_cjk_variant(text), 'sans')
}


// Typst's font list syntax for an ordered set of families
function typst_font_list(fonts:string[]):string {
    return `(${fonts.map(family => `"${escape_typst_str(family)}"`).join(', ')})`
}


// Typst source for the gray "inside of the front cover" slot a cover's preview opens on (see
// arrange_spreads): one page the size of the book's, labelled in the middle. Typeset rather than
// drawn for the same reason as the preview strip below. `label` is already translated
export function gen_cover_slot_typst(page:{width:string, height:string}, label:string,
        fonts:string[]):string {
    return [
        `#set page(width: ${page.width}, height: ${page.height}, margin: 10%,`
            + ' fill: rgb(230, 230, 230))',
        `#set text(font: ${typst_font_list(fonts)}, size: 18pt, fill: rgb(140, 140, 140))`,
        `#align(center + horizon)[${escape_typst(label)}]`,
    ].join('\n')
}


// Typst source for the short notice strip a preview gets at its start ("this is only a
// preview") or end ("end of preview"): 80% of a trim page wide and only as tall as its text,
// on a light orange ground so it reads as a note rather than a page of content. Typeset by Typst
// rather than drawn by pdf-lib, whose built-in fonts can't draw most of the world's scripts nor
// shape any that need it. `locale` is the UI locale the text is in (e.g. "vie", "zho-Hant"),
// `fonts` every family to use, in order. Text is passed in already translated (this package has
// no UI i18n).
export function gen_preview_strip_typst(page_width:string, title:string, subtitle:string,
        locale:string, dir:TextDir, fonts:string[]):string {
    const lang = resolve_lang(locale.split('-')[0])
    return [
        `#set page(width: ${page_width} * 0.8, height: auto, margin: ${PREVIEW_STRIP_PADDING}pt,`
            + ' fill: rgb(255, 224, 178))',
        `#set text(font: ${typst_font_list(fonts)}, lang: "${lang}", dir: ${dir},`
            + ' hyphenate: false, fill: rgb(26, 26, 26))',
        '#set align(center)',
        '#set par(justify: false)',
        `#stack(spacing: ${PREVIEW_STRIP_LINE_GAP}pt,`,
        `    text(weight: "bold", size: ${PREVIEW_STRIP_TITLE_SIZE}pt)[${escape_typst(title)}],`,
        `    text(size: ${PREVIEW_STRIP_SUBTITLE_SIZE}pt, fill: rgb(77, 77, 77))`
            + `[${escape_typst(subtitle)}],`,
        ')',
    ].join('\n')
}


// Add a compiled preview strip (gen_preview_strip_typst) to a preview PDF — position 'start'
// prepends it as page 1, 'end' appends it as the last page. Called after every other assembly
// step (cover merge included) so it always lands at the very edge of the document, in every view
// and section.
export async function add_preview_strip(
    pdf_bytes:Uint8Array, strip_pdf:Uint8Array, position:'start'|'end',
):Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdf_bytes)
    const strip = await PDFDocument.load(strip_pdf)
    const [page] = await doc.copyPages(strip, [0])
    if (position === 'start') {
        doc.insertPage(0, page!)
    } else {
        doc.addPage(page!)
    }
    return doc.save()
}


// Prepend a rendered cover (its single wraparound page) to a book PDF, for the preview only —
// stored versions keep the cover as its own separate cover.pdf. The page is cropped to its trim
// box (bleed hidden) and gets 50%-gray guide lines on the fold(s). Both are preview aids: the
// content is untouched and the real cover PDF is produced by a different path
export async function prepend_cover(
    cover_bytes:Uint8Array, book_bytes:Uint8Array, geometry:CoverPageGeometry|null,
):Promise<Uint8Array> {
    const book = await PDFDocument.load(book_bytes)
    const cover_doc = await PDFDocument.load(cover_bytes)
    const [cover_page] = await book.copyPages(cover_doc, [0])

    if (geometry){
        const page_h = cover_page!.getHeight()
        // Crop to the trim box (drop the bleed) — a display-only crop, content is preserved
        if (geometry.crop){
            const {left, top, width, height} = geometry.crop
            cover_page!.setCropBox(left, page_h - (top + height), width, height)
        }
        // Gray fold guide lines, clipped by the crop box above to the visible trim height
        const gray = rgb(0.5, 0.5, 0.5)
        for (const x of geometry.fold_x){
            cover_page!.drawLine({
                start: {x, y: 0},
                end: {x, y: page_h},
                thickness: 0.5,
                color: gray,
            })
        }
    }

    book.insertPage(0, cover_page!)
    return book.save()
}


// Split every double-width page into two pages of half the width. embedPage's bounding box
// clips (form XObject BBox) and is normalised back to the origin by the XObject matrix, so
// both halves draw at (0, 0) and nothing bleeds across the cut.
async function split_facing(wide_doc:PDFDocument):Promise<PDFDocument> {
    const out = await PDFDocument.create()
    for (const page of wide_doc.getPages()) {
        const {width, height} = page.getSize()
        const half = width / 2
        const left = await out.embedPage(page,
            {left: 0, bottom: 0, right: half, top: height})
        const right = await out.embedPage(page,
            {left: half, bottom: 0, right: width, top: height})
        out.addPage([half, height]).drawPage(left, {x: 0, y: 0})
        out.addPage([half, height]).drawPage(right, {x: 0, y: 0})
    }
    return out
}


// Apply booklet imposition: reorder pages for fold-at-home 2-up printing. The assembled document
// must already be padded to an even page count (a multiple of 4 for print — see generate_pdf)
async function apply_booklet(assembled_doc:PDFDocument, request:TypstRequest):Promise<Uint8Array> {

    // Create new document with 2-up pages
    const booklet_doc = await PDFDocument.create()
    const total = assembled_doc.getPageCount()
    const first_page = assembled_doc.getPage(0)
    const {width: page_w, height: page_h} = first_page.getSize()

    for (let i = 0; i < total / 2; i++) {

        // Get next pages from start and end (folding order)
        let lhs_idx = total - 1 - i
        let rhs_idx = i

        // Flip order for odd sheets (printed on reverse side)
        if (i % 2 === 1) {
            ;[lhs_idx, rhs_idx] = [rhs_idx, lhs_idx]
        }

        // Create a landscape page (2x width)
        const new_page = booklet_doc.addPage([page_w * 2, page_h])

        // Embed and place the two pages side by side
        const [lhs_embed] = await booklet_doc.embedPages(
            [assembled_doc.getPage(lhs_idx)],
        )
        const [rhs_embed] = await booklet_doc.embedPages(
            [assembled_doc.getPage(rhs_idx)],
        )

        // LHS at x=0, RHS at x=page_w
        new_page.drawPage(lhs_embed!, {x: 0, y: 0, width: page_w, height: page_h})
        new_page.drawPage(rhs_embed!, {x: page_w, y: 0, width: page_w, height: page_h})

        // Portrait mode: rotate each landscape spread 90° so it prints on a portrait sheet.
        // The booklet pages alternate front/back (even = front, odd = back), so rotate the
        // backs an extra 180° (front 90°, back 270°). That bakes in the short-edge flip the
        // imposition expects, so the printer's ordinary flip-on-long-edge duplex reproduces
        // it — for printers that can't do flip-on-short-edge themselves.
        if (request.booklet_portrait) {
            new_page.setRotation(degrees(i % 2 === 0 ? 90 : 270))
        }
    }

    // Set duplex preference: short-edge for landscape booklets, long-edge when rotated to
    // portrait (pdf-lib has no ViewerPreferences API, so set it via the catalog directly)
    const catalog = booklet_doc.catalog
    const context = booklet_doc.context
    const prefs = context.obj({
        Duplex: request.booklet_portrait ? '/DuplexFlipLongEdge' : '/DuplexFlipShortEdge',
    })
    catalog.set(context.obj('ViewerPreferences') as any, prefs)

    const pdf_bytes = await booklet_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Apply PDF metadata to compiled bytes, shrinking merge/imposition bloat along the way
async function apply_metadata(
    pdf_bytes:Uint8Array, request:TypstRequest,
):Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdf_bytes)

    // Sweep orphans, compress raw streams, and dedup the font subsets that pdf-lib's
    // page copying/embedding duplicates (see pdf_optimize.ts)
    await optimize_pdf(doc)

    doc.setTitle(request.title)
    doc.setProducer('paper.bible')
    doc.setCreationDate(new Date())
    doc.setSubject(`Paper.Bible`)

    return doc.save()
}
