
import {PDFDocument, PDFPage, degrees, rgb} from 'pdf-lib'

import {generate_typst, generate_typst_passage, generate_typst_blank,
    generate_typst_lines, group_content, passage_is_alternate} from './generate.js'
import {optimize_pdf} from './pdf_optimize.js'

import type {TypstRequest, TypstContentItem, TypstPassage, CompileFn, ProgressFn,
    } from './types.js'


// Full pipeline: generate Typst source(s), compile via provided function, assemble and
// post-process the PDF. Handles alternate interleaving, half-blank, booklet imposition.
export async function generate_pdf(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn,
):Promise<Uint8Array> {

    // Assemble the printed page sequence (each section compiled separately, see assemble_pages),
    // then arrange for print
    const {final_doc, blank_doc} = await assemble_pages(request, compile_fn, on_progress)
    if (request.arrangement === 'booklet') {
        on_progress?.({stage: 'arrange', label: 'booklet'})
        on_progress?.({stage: 'finalize'})
        return await apply_booklet(final_doc, request, blank_doc)
    }
    on_progress?.({stage: 'finalize'})
    const pdf_bytes = await final_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Preview pipeline: lay out the printed pages as facing-page book spreads, as if the book
// were opened — a blank left page beside page 1 on the right, then 2|3, 4|5, etc. Includes
// every blank/note page exactly as printed. For on-screen preview only, never for printing.
export async function generate_pdf_spread_preview(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn,
):Promise<Uint8Array> {

    // A folded booklet reads in the same sequential order as a book, so assemble either as a
    // book (normal stays normal — it has no blank pages by design)
    const arrangement = request.arrangement === 'booklet' ? 'book' : request.arrangement
    const reading_request:TypstRequest = {...request, arrangement}

    const {final_doc: reading_doc} = await assemble_pages(reading_request, compile_fn, on_progress)
    on_progress?.({stage: 'arrange', label: 'spreads'})
    on_progress?.({stage: 'finalize'})
    return await arrange_spreads(reading_doc, reading_request)
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
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn,
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

    // Process each content group (a group merges new_page=false items onto one page)
    const groups = group_content(request.content)
    for (const [group_index, group] of groups.entries()) {
        const head = group[0]!

        // Report each group as it starts (passages by their reference, so long documents show
        // per-passage progress)
        const label = head.type === 'passage' ? head.progress_label : `${head.type} page`
        on_progress?.({stage: 'compile', i: group_index + 1, total: groups.length, label})

        // Alternate-translation passage: two bibles compiled separately and interleaved.
        // Such a passage never merges, so it is always its own single-item group.
        if (group.length === 1 && passage_is_alternate(head)) {
            await process_alternate(
                head as TypstPassage, request, compile_fn, final_doc,
                show_pages_list, booklike, add_page, add_blank,
            )
            continue
        }

        // Plain group (inline passages/customs, or a single title). Titles never take page
        // numbers; alone titles get an even-page start and a blank rear.
        const is_alone_title = head.type === 'title' && head.alone
        const show_pages = request.show_pages && head.type !== 'title'

        if (is_alone_title && booklike && final_doc.getPageCount() % 2 === 1) {
            await add_blank()
        }

        // Compile the whole group as one continuous document. The start page keeps the page
        // counter continuous with what's already been assembled, since each section/group is
        // its own Typst compile (its internal counter would otherwise restart at 1)
        const group_doc = await compile_group(
            request, group, compile_fn, final_doc.getPageCount() + 1,
        )

        // Half-blank: any passage in the group carries the (global) half_blank direction. Face
        // every page of the compiled group with a blank/lines page — blanks are added here,
        // after the content document is rendered, so merged items just extend that content.
        const hb_passage = group.find(
            (it):it is TypstPassage => it.type === 'passage' && it.half_blank !== null,
        )
        if (hb_passage) {
            await process_faced(
                group_doc, hb_passage, request, compile_fn, final_doc,
                show_pages_list, booklike, add_page, add_blank,
            )
            continue
        }

        // A lines page deliberately over-fills (see gen_lines) so it reaches the bottom of any
        // page size, spilling onto extra physical pages that must be discarded — only the first
        // is real content (same convention as the facing lines page in process_faced below)
        const page_limit = head.type === 'lines' ? 1 : group_doc.getPageCount()
        for (let p = 0; p < page_limit; p++) {
            await add_page(group_doc, p, show_pages)
        }

        if (is_alone_title && booklike && group_doc.getPageCount() % 2 !== 0) {
            await add_blank()
        }
    }

    return {final_doc, blank_doc}
}


// Compile a content group into a single continuous PDF (no page breaks within the group).
// start_page offsets the group's page counter so numbers stay continuous across sections.
async function compile_group(
    request:TypstRequest, group:TypstContentItem[], compile_fn:CompileFn, start_page:number,
):Promise<PDFDocument> {
    const source = generate_typst(make_group_request(request, group), start_page)
    const bytes = await compile_fn(source)
    return await PDFDocument.load(bytes)
}


// Process an alternate-translation passage — interleave the two bibles page by page
async function process_alternate(
    passage:TypstPassage,
    request:TypstRequest,
    compile_fn:CompileFn,
    final_doc:PDFDocument,
    show_pages_list:boolean[],
    booklike:boolean,
    add_page:(doc:PDFDocument|null, idx:number, show:boolean) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    const show_pages = request.show_pages

    // LHS is the primary bible; RHS is the secondary bible
    const lhs_source = generate_typst_passage(request, passage, 0)
    const lhs_doc = await PDFDocument.load(await compile_fn(lhs_source))
    const rhs_source = generate_typst_passage(request, passage, 1)
    const rhs_doc:PDFDocument|null = await PDFDocument.load(await compile_fn(rhs_source))

    const lhs_count = lhs_doc.getPageCount()
    const rhs_count = rhs_doc.getPageCount()
    const max_pages = Math.max(lhs_count, rhs_count)

    // Ensure the pair starts on the correct pages for book-like arrangement
    if (booklike && final_doc.getPageCount() % 2 !== 1) {
        await add_blank()
    }

    // Which bible sits on the left (half_blank direction can flip the pair, rare with alternate)
    const content_is_left = passage.half_blank !== 'left'
    const left_doc = content_is_left ? lhs_doc : rhs_doc
    const left_count = content_is_left ? lhs_count : rhs_count
    const right_doc = content_is_left ? rhs_doc : lhs_doc
    const right_count = content_is_left ? rhs_count : lhs_count

    // Interleave the two bibles page by page (padding with blanks if lengths differ)
    for (let p = 0; p < max_pages; p++) {
        if (p < left_count) {
            await add_page(left_doc, p, show_pages)
        } else {
            await add_blank()
        }
        if (p < right_count) {
            await add_page(right_doc, p, show_pages)
        } else {
            await add_blank()
        }
    }
}


// Process a half-blank group — the compiled content doc on one side, a blank or lines page
// facing it. Blanks are added here, after the content is rendered, so merged items just extend
// the content document and get faced like any other page.
async function process_faced(
    content_doc:PDFDocument,
    passage:TypstPassage,
    request:TypstRequest,
    compile_fn:CompileFn,
    final_doc:PDFDocument,
    show_pages_list:boolean[],
    booklike:boolean,
    add_page:(doc:PDFDocument|null, idx:number, show:boolean) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    const show_pages = request.show_pages

    // Ruled lines on the facing side (reused for every page); otherwise a plain blank
    let lines_doc:PDFDocument|null = null
    if (passage.show_lines) {
        const lines_source = generate_typst_lines(request, '10mm')
        lines_doc = await PDFDocument.load(await compile_fn(lines_source))
    }

    // Ensure the pair starts on the correct page for book-like arrangement
    if (booklike && final_doc.getPageCount() % 2 !== 1) {
        await add_blank()
    }

    // Add the facing (blank or lines) side
    const add_facing = async () => {
        if (lines_doc) {
            await add_page(lines_doc, 0, false)
        } else {
            await add_blank()
        }
    }

    const content_is_left = passage.half_blank !== 'left'
    for (let p = 0; p < content_doc.getPageCount(); p++) {
        if (content_is_left) {
            await add_page(content_doc, p, show_pages)
            await add_facing()
        } else {
            await add_facing()
            await add_page(content_doc, p, show_pages)
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


// Create a modified request holding only a content group (for isolated compilation). The group
// is compiled as one continuous document so its merged items share pages; the outer assemble
// pass handles page arrangement, so it is forced to 'normal' here.
function make_group_request(
    request:TypstRequest, group:TypstContentItem[],
):TypstRequest {
    return {
        ...request,
        content: group,
        arrangement: 'normal',
    }
}
