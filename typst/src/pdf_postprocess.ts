
import {PDFDocument, PDFPage, degrees, rgb} from 'pdf-lib'

import {generate_typst, generate_typst_facing, generate_typst_blank,
    generate_typst_lines, passage_is_alternate} from './generate.js'
import {optimize_pdf} from './pdf_optimize.js'

import type {TypstRequest, TypstContentItem, TypstPassage, CompileFn, ProgressFn,
    } from './types.js'


// Full pipeline: generate Typst source(s), compile via provided function, assemble and
// post-process the PDF. Handles alternate interleaving, half-blank, booklet imposition.
// preview relaxes the print-only padding rules: trailing blank pages are dropped and page
// counts are only kept even (rather than booklet-padded to a multiple of 4), since a screen
// preview only needs recto/verso parity to read correctly.
export async function generate_pdf(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn, preview = false,
):Promise<Uint8Array> {

    // Preview notice pages read sequentially in non-booklet arrangements, so they simply join
    // the content as the first/last items; booklets handle them after imposition below (fold
    // order would otherwise pair the document's last page with page 1 on the first sheet)
    if (request.arrangement !== 'booklet') {
        request = {...request, content: content_with_notices(request)}
    }

    // Assemble the printed page sequence (each section compiled separately, see assemble_pages),
    // then arrange for print
    const {final_doc, blank_doc, blank_flags} = await assemble_pages(
        request, compile_fn, on_progress)

    // Previews drop the run of blank pages at the very end — they carry no information on
    // screen (evenness is restored below where it matters)
    if (preview) {
        trim_trailing_blanks(final_doc, blank_flags)
    }

    if (request.arrangement === 'booklet') {
        // Notice pages stay out of the fold order — compile each on its own (no page number,
        // they sit outside the printed sequence) so apply_booklet can place them around the
        // imposed sheets
        const front_doc = await compile_notice(request, request.preview_front, compile_fn)
        const rear_doc = await compile_notice(request, request.preview_rear, compile_fn)
        on_progress?.({stage: 'arrange', label: 'booklet'})
        on_progress?.({stage: 'finalize'})
        return await apply_booklet(final_doc, request, blank_doc, preview, front_doc, rear_doc)
    }

    // Keep a trimmed book preview even so facing-page parity still reads correctly
    if (preview && request.arrangement === 'book' && final_doc.getPageCount() % 2 === 1) {
        const [page] = await final_doc.copyPages(blank_doc, [0])
        final_doc.addPage(page as PDFPage)
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
    // book (normal stays normal — it has no blank pages by design). Preview notice pages also
    // read sequentially here, so they simply join the content as the first/last items
    const arrangement = request.arrangement === 'booklet' ? 'book' : request.arrangement
    const reading_request:TypstRequest = {
        ...request, arrangement, content: content_with_notices(request)}

    const {final_doc: reading_doc, blank_flags} = await assemble_pages(
        reading_request, compile_fn, on_progress)

    // Trailing blank pages carry no information on screen — arrange_spreads pads its slots to
    // even itself, so they can all go
    trim_trailing_blanks(reading_doc, blank_flags)

    on_progress?.({stage: 'arrange', label: 'spreads'})
    on_progress?.({stage: 'finalize'})
    return await arrange_spreads(reading_doc, reading_request)
}


// Splice the preview-only notice pages (if any) into the content list, for arrangements that
// read sequentially — the notices just become the first/last pages
function content_with_notices(request:TypstRequest):TypstContentItem[] {
    const content = [...request.content]
    if (request.preview_front) {
        content.unshift(request.preview_front)
    }
    if (request.preview_rear) {
        content.push(request.preview_rear)
    }
    return content
}


// Compile a preview notice page on its own, without a page number (it sits outside the
// printed page sequence). Returns null when the page isn't set.
async function compile_notice(
    request:TypstRequest, notice:TypstContentItem|undefined, compile_fn:CompileFn,
):Promise<PDFDocument|null> {
    if (!notice) {
        return null
    }
    return await compile_item({...request, running_pages: false}, notice, compile_fn, 1)
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
):Promise<{final_doc:PDFDocument, blank_doc:PDFDocument, blank_flags:boolean[]}> {

    const booklike = request.arrangement !== 'normal'

    // Compile a blank page for padding
    const blank_source = generate_typst_blank(request)
    const blank_pdf = await compile_fn(blank_source, request.assets)
    const blank_doc = await PDFDocument.load(blank_pdf)

    // Start building the final PDF
    const final_doc = await PDFDocument.create()
    const show_pages_list:boolean[] = []
    // Whether each assembled page is a padding blank (lines pages count as content), so
    // preview arrangements can trim meaningless trailing blanks (see trim_trailing_blanks)
    const blank_flags:boolean[] = []

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
        blank_flags.push(source_doc === null)
    }

    // Helper: add a blank page
    async function add_blank() {
        await add_page(null, 0, false)
    }

    // Process each content item (each compiles as its own document)
    for (const [index, item] of request.content.entries()) {

        // Report each item as it starts (passages by their reference, so long documents show
        // per-passage progress)
        const label = item.type === 'passage' ? item.progress_label : `${item.type} page`
        on_progress?.({stage: 'compile', i: index + 1, total: request.content.length, label})

        // Facing-pages passage: both translations compiled together double-width, then split
        if (passage_is_alternate(item)) {
            await process_facing(
                item as TypstPassage, request, compile_fn, final_doc,
                booklike, add_page, add_blank,
            )
            continue
        }

        // Titles never take page numbers. titlepage_always forces every title page to start on
        // the given side — a blank is inserted first if the current page count doesn't already
        // put the next page on that side. Nothing is padded after the item (that's the removed
        // "ensure other side of page blank" behavior — only the start side is ever forced).
        const title_always = item.type === 'title' ? request.titlepage.always : null
        const show_pages = request.running_pages && item.type !== 'title'

        if (title_always && booklike) {
            // 0-indexed even page count so far -> next page lands recto/right (see the identical
            // convention in process_faced's half_blank handling below)
            const need_blank = title_always === 'right'
                ? final_doc.getPageCount() % 2 === 1
                : final_doc.getPageCount() % 2 === 0
            if (need_blank) {
                await add_blank()
            }
        }

        // Compile the item as its own document. The start page keeps the page counter
        // continuous with what's already been assembled, since each section is its own Typst
        // compile (its internal counter would otherwise restart at 1)
        const item_doc = await compile_item(
            request, item, compile_fn, final_doc.getPageCount() + 1,
        )

        // Half-blank: face every page of the compiled passage with a blank/lines page
        if (item.type === 'passage' && item.half_blank !== null) {
            await process_faced(
                item_doc, item, request, compile_fn, final_doc,
                show_pages_list, booklike, add_page, add_blank,
            )
            continue
        }

        // A lines page deliberately over-fills (see gen_lines) so it reaches the bottom of any
        // page size, spilling onto extra physical pages that must be discarded — only the first
        // is real content (same convention as the facing lines page in process_faced below)
        const page_limit = item.type === 'lines' ? 1 : item_doc.getPageCount()
        for (let p = 0; p < page_limit; p++) {
            await add_page(item_doc, p, show_pages)
        }
    }

    return {final_doc, blank_doc, blank_flags}
}


// Remove the run of blank pages at the very end of an assembled document. Preview only —
// printed documents keep every padding page. Callers restore evenness where needed.
function trim_trailing_blanks(doc:PDFDocument, blank_flags:boolean[]):void {
    let count = doc.getPageCount()
    while (count > 1 && blank_flags[count - 1]) {
        doc.removePage(count - 1)
        blank_flags.pop()
        count--
    }
}


// Compile a single content item into its own PDF document.
// start_page offsets the item's page counter so numbers stay continuous across sections.
async function compile_item(
    request:TypstRequest, item:TypstContentItem, compile_fn:CompileFn, start_page:number,
):Promise<PDFDocument> {
    const source = generate_typst(make_item_request(request, item), start_page)
    const bytes = await compile_fn(source, request.assets)
    return await PDFDocument.load(bytes)
}


// Process a facing-pages passage: both translations lay out together as aligned rows on
// double-width pages (compiled once, so they can never drift apart), then every page splits
// down the centre cut — the primary translation lands on the verso and the second on the
// facing recto, each at the target trim size with full-width lines.
async function process_facing(
    passage:TypstPassage,
    request:TypstRequest,
    compile_fn:CompileFn,
    final_doc:PDFDocument,
    booklike:boolean,
    add_page:(doc:PDFDocument|null, idx:number, show:boolean) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    // Start on a verso so each split pair reads as one open spread
    if (booklike && final_doc.getPageCount() % 2 !== 1) {
        await add_blank()
    }

    // The double-width footer prints each half's own final page number, so it needs the
    // starting page rather than a counter offset (the counter advances once per double page)
    const source = generate_typst_facing(request, passage, final_doc.getPageCount() + 1)
    const wide_doc = await PDFDocument.load(await compile_fn(source, request.assets))
    const split_doc = await split_facing(wide_doc)

    for (let p = 0; p < split_doc.getPageCount(); p++) {
        await add_page(split_doc, p, request.running_pages)
    }
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

    const show_pages = request.running_pages

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


// Apply booklet imposition: reorder pages for fold-at-home 2-up printing. front_doc/rear_doc
// are the pre-compiled preview notice pages (if any), placed before/after the imposed sheets
// so they don't get folded into the sheet pairing.
async function apply_booklet(
    assembled_doc:PDFDocument, request:TypstRequest, blank_doc:PDFDocument, preview = false,
    front_doc:PDFDocument|null = null, rear_doc:PDFDocument|null = null,
):Promise<Uint8Array> {

    // Ensure page count is a multiple of 4 (a physical folded sheet holds 4 pages). Previews
    // aren't printed, so they only pad to even — just enough for the 2-up pairing below.
    const page_count = assembled_doc.getPageCount()
    const target_count = preview
        ? Math.ceil(page_count / 2) * 2
        : Math.ceil(page_count / 4) * 4

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

    // Place the preview notice pages around the imposed sheets as standalone pages at their
    // natural trim size — informational only, so they stay out of the fold order above
    if (front_doc) {
        const [page] = await booklet_doc.copyPages(front_doc, [0])
        booklet_doc.insertPage(0, page as PDFPage)
    }
    if (rear_doc) {
        const [page] = await booklet_doc.copyPages(rear_doc, [0])
        booklet_doc.addPage(page as PDFPage)
    }

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


// Create a modified request holding only one content item (for isolated compilation). The
// outer assemble pass handles page arrangement, so it is forced to 'normal' here.
function make_item_request(request:TypstRequest, item:TypstContentItem):TypstRequest {
    return {
        ...request,
        content: [item],
        arrangement: 'normal',
    }
}
