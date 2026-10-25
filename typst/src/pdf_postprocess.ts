
import {PDFDocument, PDFPage, degrees} from 'pdf-lib'

import {assemble_pages, trim_trailing_blanks, pin_last_item, pad_multiple, pad_pages,
    place_last_item} from './assemble.js'
import {optimize_pdf} from './pdf_optimize.js'

import type {Assembly, PageBackend} from './assemble.js'
import type {TypstRequest, CompileFn, ProgressFn} from './types.js'


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
