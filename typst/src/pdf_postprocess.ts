
import {PDFDocument, PDFPage, degrees, rgb} from 'pdf-lib'

import {generate_typst, generate_typst_passage, generate_typst_blank,
    generate_typst_lines} from './generate.js'

import type {TypstRequest, TypstPassage, CompileFn} from './types.js'


// Full pipeline: generate Typst source(s), compile via provided function, assemble and
// post-process the PDF. Handles alternate interleaving, half-blank, booklet imposition.
export async function generate_pdf(
    request:TypstRequest, compile_fn:CompileFn,
):Promise<Uint8Array> {

    if (!needs_multi_doc(request) && request.arrangement !== 'booklet') {
        // Simple case: single document, no post-processing needed
        const source = generate_typst(request)
        const pdf_bytes = await compile_fn(source)
        return apply_metadata(pdf_bytes, request)
    }

    // Complex case: assemble the printed page sequence, then arrange for print
    const {final_doc, blank_doc} = await assemble_pages(request, compile_fn)
    if (request.arrangement === 'booklet') {
        return await apply_booklet(final_doc, request, blank_doc)
    }
    const pdf_bytes = await final_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Determine if any passage needs multi-document handling (alternate or half-blank)
function needs_multi_doc(request:TypstRequest):boolean {
    return request.content.some(item =>
        item.type === 'passage' && (
            (item.bibles.length > 1 && item.multi_layout === 'alternate')
            || item.half_blank !== null
        ),
    )
}


// Preview pipeline: lay out the printed pages as facing-page book spreads, as if the book
// were opened — a blank left page beside page 1 on the right, then 2|3, 4|5, etc. Includes
// every blank/note page exactly as printed. For on-screen preview only, never for printing.
export async function generate_pdf_spread_preview(
    request:TypstRequest, compile_fn:CompileFn,
):Promise<Uint8Array> {

    // A folded booklet reads in the same sequential order as a book, so assemble either as a
    // book (normal stays normal — it has no blank pages by design)
    const arrangement = request.arrangement === 'booklet' ? 'book' : request.arrangement
    const reading_request:TypstRequest = {...request, arrangement}

    const reading_doc = await build_reading_doc(reading_request, compile_fn)
    return await arrange_spreads(reading_doc, reading_request)
}


// Build the printed page sequence (reading order, with blanks) as a single PDFDocument,
// without booklet imposition. Mirrors generate_pdf's branching but stops before arranging.
async function build_reading_doc(
    request:TypstRequest, compile_fn:CompileFn,
):Promise<PDFDocument> {

    if (!needs_multi_doc(request)) {
        // Single document — any book-mode blank pages are baked into the source via pagebreaks
        const source = generate_typst(request)
        const pdf_bytes = await compile_fn(source)
        return await PDFDocument.load(pdf_bytes)
    }

    const {final_doc} = await assemble_pages(request, compile_fn)
    return final_doc
}


// Arrange a reading-order document into facing-page spreads: a leading blank so page 1 sits
// on the right, then each subsequent pair side by side. Each spread is one landscape page
// (2x width) with the two pages drawn left and right (same 2-up technique as apply_booklet).
async function arrange_spreads(
    reading_doc:PDFDocument, request:TypstRequest,
):Promise<Uint8Array> {

    const total = reading_doc.getPageCount()
    if (total === 0) {
        return await reading_doc.save()
    }

    const spread_doc = await PDFDocument.create()
    const {width: page_w, height: page_h} = reading_doc.getPage(0).getSize()

    // Slot order: a leading blank (null) so page 1 lands on the right, then every page in
    // reading order. Pad to even so the final spread has both sides.
    const slots:(number|null)[] = [null]
    for (let p = 0; p < total; p++) {
        slots.push(p)
    }
    if (slots.length % 2 === 1) {
        slots.push(null)
    }

    // Each pair of slots becomes one spread; null slots are left blank (white)
    for (let i = 0; i < slots.length; i += 2) {
        const new_page = spread_doc.addPage([page_w * 2, page_h])
        const left_slot = slots[i]
        const right_slot = slots[i + 1]

        if (left_slot != null) {
            const [embed] = await spread_doc.embedPages([reading_doc.getPage(left_slot)])
            new_page.drawPage(embed!, {x: 0, y: 0, width: page_w, height: page_h})
        }
        if (right_slot != null) {
            const [embed] = await spread_doc.embedPages([reading_doc.getPage(right_slot)])
            new_page.drawPage(embed!, {x: page_w, y: 0, width: page_w, height: page_h})
        }

        // Solid black line down the centre seam, dividing the two facing pages (preview only)
        new_page.drawLine({
            start: {x: page_w, y: 0},
            end: {x: page_w, y: page_h},
            thickness: 1,
            color: rgb(0, 0, 0),
        })
    }

    const pdf_bytes = await spread_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Build subjobs from content items, compile each, and assemble the printed page sequence
// (reading order, including all blank/note pages) — before any booklet imposition
async function assemble_pages(
    request:TypstRequest, compile_fn:CompileFn,
):Promise<{final_doc:PDFDocument, blank_doc:PDFDocument}> {

    const booklike = request.arrangement !== 'normal'

    // Compile a blank page for padding
    const blank_source = generate_typst_blank(request)
    const blank_pdf = await compile_fn(blank_source)
    const blank_doc = await PDFDocument.load(blank_pdf)

    // Start building the final PDF
    const final_doc = await PDFDocument.create()
    const show_pages_list:boolean[] = []

    // Helper: add a page to the final doc
    async function add_page(
        source_doc:PDFDocument|null, page_index:number, show_pages:boolean,
    ) {
        if (source_doc === null) {
            if (!booklike) {
                return  // Skip blanks in 'normal' mode
            }
            // Copy blank page
            const [page] = await final_doc.copyPages(blank_doc, [0])
            final_doc.addPage(page as PDFPage)
        } else {
            const [page] = await final_doc.copyPages(source_doc, [page_index])
            final_doc.addPage(page as PDFPage)
        }
        show_pages_list.push(source_doc === null ? false : show_pages)
    }

    // Helper: add a blank page
    async function add_blank() {
        await add_page(null, 0, false)
    }

    // Process each content item
    for (let i = 0; i < request.content.length; i++) {
        const item = request.content[i]!

        if (item.type === 'passage') {
            await process_passage(
                item, request, compile_fn, final_doc, blank_doc,
                show_pages_list, booklike, add_page, add_blank,
            )
        } else {
            // Non-passage items: compile and add all pages
            const modified_request = make_single_item_request(request, item)
            const source = generate_typst(modified_request)
            const pdf_bytes = await compile_fn(source)
            const doc = await PDFDocument.load(pdf_bytes)

            const is_alone_item = item.type === 'title' && item.alone
            const show_pages = request.show_pages && item.type !== 'title'

            // Ensure alone items start on even page
            if (is_alone_item && booklike && final_doc.getPageCount() % 2 === 1) {
                await add_blank()
            }

            for (let p = 0; p < doc.getPageCount(); p++) {
                await add_page(doc, p, show_pages)
            }

            // Ensure alone items have blank rear
            if (is_alone_item && booklike && doc.getPageCount() % 2 !== 0) {
                await add_blank()
            }
        }
    }

    return {final_doc, blank_doc}
}


// Process a passage content item — handles alternate interleaving and half-blank
async function process_passage(
    passage:TypstPassage,
    request:TypstRequest,
    compile_fn:CompileFn,
    final_doc:PDFDocument,
    blank_doc:PDFDocument,
    show_pages_list:boolean[],
    booklike:boolean,
    add_page:(doc:PDFDocument|null, idx:number, show:boolean) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    const show_pages = request.show_pages
    const has_alternate = passage.bibles.length > 1 && passage.multi_layout === 'alternate'
    const has_half_blank = passage.half_blank !== null

    // Compile LHS (primary bible or single-document passage)
    let lhs_doc:PDFDocument
    if (has_alternate) {
        // Alternate layout: LHS is just the primary bible (the secondary becomes the RHS pages)
        const lhs_source = generate_typst_passage(request, passage, 0)
        const lhs_bytes = await compile_fn(lhs_source)
        lhs_doc = await PDFDocument.load(lhs_bytes)
    } else if (has_half_blank) {
        // Half-blank: LHS is the whole passage so a 2-translation columns layout keeps both
        // translations (rendered as a side-by-side grid); the RHS is the blank/lines side
        const modified = make_single_item_request(request, passage)
        const source = generate_typst(modified)
        const bytes = await compile_fn(source)
        lhs_doc = await PDFDocument.load(bytes)
    } else {
        // Simple passage: compile the whole thing as one doc
        const modified = make_single_item_request(request, passage)
        const source = generate_typst(modified)
        const bytes = await compile_fn(source)
        lhs_doc = await PDFDocument.load(bytes)

        // Just add all pages
        for (let p = 0; p < lhs_doc.getPageCount(); p++) {
            await add_page(lhs_doc, p, show_pages)
        }
        return
    }

    // Compile RHS if alternate, or prepare blank/lines for half-blank
    let rhs_doc:PDFDocument|null = null
    if (has_alternate) {
        const rhs_source = generate_typst_passage(request, passage, 1)
        const rhs_bytes = await compile_fn(rhs_source)
        rhs_doc = await PDFDocument.load(rhs_bytes)
    } else if (has_half_blank && passage.show_lines) {
        // Compile a lines page to use as the half-blank side
        const lines_source = generate_typst_lines(request, '10mm')
        const lines_bytes = await compile_fn(lines_source)
        rhs_doc = await PDFDocument.load(lines_bytes)
    }
    // If half_blank without lines, rhs_doc stays null (pure blank pages)

    const lhs_count = lhs_doc.getPageCount()
    const rhs_count = rhs_doc?.getPageCount() ?? 0
    const max_pages = Math.max(lhs_count, rhs_count || lhs_count)

    // Ensure LHS/RHS start on correct pages for book-like arrangement
    if (booklike && final_doc.getPageCount() % 2 !== 1) {
        await add_blank()
    }

    // Interleave pages
    for (let p = 0; p < max_pages; p++) {

        // Determine which side is content vs blank based on half_blank direction
        const content_is_left = passage.half_blank !== 'left'

        if (content_is_left) {
            // Content (LHS) on left, blank/rhs on right
            if (p < lhs_count) {
                await add_page(lhs_doc, p, show_pages)
            } else {
                await add_blank()
            }
            // RHS: alternate translation, lines, or blank
            if (rhs_doc && p < (has_alternate ? rhs_count : 1)) {
                // For lines, reuse the same single page; for alternate, use page p
                const rhs_page = has_alternate ? p : 0
                if (rhs_page < rhs_doc.getPageCount()) {
                    await add_page(rhs_doc, rhs_page, has_alternate ? show_pages : false)
                } else {
                    await add_blank()
                }
            } else {
                await add_blank()
            }
        } else {
            // Blank/rhs on left, content (LHS) on right
            if (rhs_doc && p < (has_alternate ? rhs_count : 1)) {
                const rhs_page = has_alternate ? p : 0
                if (rhs_page < rhs_doc.getPageCount()) {
                    await add_page(rhs_doc, rhs_page, has_alternate ? show_pages : false)
                } else {
                    await add_blank()
                }
            } else {
                await add_blank()
            }
            if (p < lhs_count) {
                await add_page(lhs_doc, p, show_pages)
            } else {
                await add_blank()
            }
        }
    }
}


// Apply booklet imposition: reorder pages for fold-at-home 2-up printing
async function apply_booklet(
    assembled_doc:PDFDocument, request:TypstRequest, blank_doc:PDFDocument,
):Promise<Uint8Array> {

    // Ensure page count is multiple of 4
    const page_count = assembled_doc.getPageCount()
    const target_count = Math.ceil(page_count / 4) * 4

    // Pad with compiled blank pages if needed (must have a content stream so they can be
    // embedded below — a bare pdf-lib addPage() has no Contents and fails to embed)
    if (target_count > page_count) {
        for (let i = page_count; i < target_count; i++) {
            const [page] = await assembled_doc.copyPages(blank_doc, [0])
            assembled_doc.addPage(page as PDFPage)
        }
    }

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


// Apply PDF metadata to compiled bytes
async function apply_metadata(
    pdf_bytes:Uint8Array, request:TypstRequest,
):Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdf_bytes)

    doc.setTitle(request.title)
    doc.setProducer('paper.bible')
    doc.setCreationDate(new Date())
    doc.setSubject(`Paper.Bible`)

    return doc.save()
}


// Create a modified request with only a single content item (for isolated compilation)
function make_single_item_request(
    request:TypstRequest, item:TypstRequest['content'][number],
):TypstRequest {
    return {
        ...request,
        content: [item],
        // Don't apply page arrangement for individual items
        arrangement: 'normal',
    }
}
