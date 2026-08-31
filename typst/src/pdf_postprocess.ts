
import {PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb} from 'pdf-lib'

import {generate_typst, generate_typst_facing, generate_typst_blank,
    generate_typst_lines, passage_is_alternate, half_blank_content_side} from './generate.js'
import {optimize_pdf} from './pdf_optimize.js'
import {parse_unit, to_pt} from './helpers.js'

import type {MarginMode} from './generate.js'
import type {TypstRequest, TypstContentItem, TypstPassage, CompileFn, ProgressFn,
    } from './types.js'


// Fill color for a spread-preview slot that isn't a real page (see arrange_spreads) — a subtle
// gray so it reads as "not printed" rather than a blank printed page
const NOT_A_PAGE_FILL = rgb(0.9, 0.9, 0.9)

// Text color for the "inside of cover" hint drawn on that same slot
const NOT_A_PAGE_LABEL_COLOR = rgb(0.55, 0.55, 0.55)


// A blank/lines padding page's single compiled page gets reused at many different absolute
// positions, each with its own true parity — see generate_typst_blank's alternating MarginMode.
// Callers keep both pre-compiled variants and pick per-insertion via binding_for_page rather
// than recompiling on every use. Only for generic padding — half-blank notetaking pages use a
// single fixed-side compile instead (see process_faced), since their side never depends on
// absolute position
interface BlankVariants {
    left:PDFDocument
    right:PDFDocument
}


// The binding a generic padding page at this 1-based absolute position needs to keep "inside"
// on the correct physical side — mirrors generate_typst's default start_page-parity logic
function binding_for_page(page_number:number):'left'|'right' {
    return page_number % 2 === 1 ? 'left' : 'right'
}


// Full pipeline: generate Typst source(s), compile via provided function, assemble and
// post-process the PDF. Handles alternate interleaving, half-blank, booklet imposition.
// preview relaxes the print-only padding rules: trailing blank pages are dropped and page
// counts are only kept even (rather than booklet-padded to a multiple of 4), since a screen
// preview only needs recto/verso parity to read correctly.
export async function generate_pdf(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn, preview = false,
):Promise<Uint8Array> {

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
        on_progress?.({stage: 'arrange', label: 'booklet'})
        on_progress?.({stage: 'finalize'})
        return await apply_booklet(final_doc, request, blank_doc, preview)
    }

    // Keep a trimmed book preview even so facing-page parity still reads correctly
    if (preview && request.arrangement === 'book' && final_doc.getPageCount() % 2 === 1) {
        const binding = binding_for_page(final_doc.getPageCount() + 1)
        const [page] = await final_doc.copyPages(blank_doc[binding], [0])
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
    // book (normal stays normal — it has no blank pages by design)
    const arrangement = request.arrangement === 'booklet' ? 'book' : request.arrangement
    const reading_request:TypstRequest = {...request, arrangement}

    const {final_doc: reading_doc, blank_flags} = await assemble_pages(
        reading_request, compile_fn, on_progress)

    // Trailing blank pages carry no information on screen — arrange_spreads pads its slots to
    // even itself, so they can all go
    trim_trailing_blanks(reading_doc, blank_flags)

    on_progress?.({stage: 'arrange', label: 'spreads'})
    on_progress?.({stage: 'finalize'})
    return await arrange_spreads(reading_doc, reading_request)
}


// Draw text centred within one half (page_w wide) of a spread page, starting at x_offset (0 for
// the left slot, page_w for the right)
function draw_slot_label(
    page:PDFPage, font:PDFFont, text:string, x_offset:number, page_w:number, page_h:number,
) {
    const size = 18
    const text_width = font.widthOfTextAtSize(text, size)
    page.drawText(text, {
        x: x_offset + (page_w - text_width) / 2,
        y: page_h / 2 - size / 2,
        size,
        font,
        color: NOT_A_PAGE_LABEL_COLOR,
    })
}


// Arrange a reading-order document into facing-page spreads: pages shown two-up side by side
// as if the book were open. Each spread is one landscape page (2x width) with the two pages
// drawn left and right (same 2-up technique as apply_booklet).
//
// A leading gray slot (the inside face of the front cover) is prepended only when the preview
// actually has a front cover — request.preview_cover_label is set for exactly that case — so
// page 1 then lands on the right; without a cover the pairing just starts at page 1 on the
// left, with no synthetic page.
async function arrange_spreads(
    reading_doc:PDFDocument, request:TypstRequest,
):Promise<Uint8Array> {

    const total = reading_doc.getPageCount()
    if (total === 0) {
        return await reading_doc.save()
    }

    const spread_doc = await PDFDocument.create()
    const {width: page_w, height: page_h} = reading_doc.getPage(0).getSize()

    // Only embedded when there's actually a label to draw (the CLI/server compile path never
    // sets preview_cover_label, since it has no i18n to translate it with)
    const label_font = request.preview_cover_label
        ? await spread_doc.embedFont(StandardFonts.Helvetica)
        : null

    // Slot order for the content pages: an optional leading gray slot (inside of front cover)
    // so page 1 lands on the right, then every content page in reading order. Pad to even so
    // the final spread has both sides.
    const slots:(number|null)[] = request.preview_cover_label ? [null] : []
    for (let p = 0; p < total; p++) {
        slots.push(p)
    }
    if (slots.length % 2 === 1) {
        slots.push(null)
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
            new_page.drawRectangle({x: 0, y: 0, width: page_w, height: page_h, color: NOT_A_PAGE_FILL})
            // Only the very first spread's left slot is the front cover's inside face — later
            // null slots (e.g. a trailing pad) aren't, so the label is deliberately not repeated
            if (i === 0 && label_font) {
                draw_slot_label(
                    new_page, label_font, request.preview_cover_label!, 0, page_w, page_h)
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

    const pdf_bytes = await spread_doc.save()
    return apply_metadata(pdf_bytes, request)
}


// Build subjobs from content items, compile each, and assemble the printed page sequence
// (reading order, including all blank/note pages) — before any booklet imposition
async function assemble_pages(
    request:TypstRequest, compile_fn:CompileFn, on_progress?:ProgressFn,
):Promise<{final_doc:PDFDocument, blank_doc:BlankVariants, blank_flags:boolean[]}> {

    const booklike = request.arrangement !== 'normal'

    // Compile both binding variants of the blank padding page — whichever absolute position
    // each padding page lands at (decided below, at insertion time) picks the matching one
    const blank_doc:BlankVariants = {
        left: await PDFDocument.load(await compile_fn(
            generate_typst_blank(request, {kind: 'alternating', binding: 'left'}), request.assets)),
        right: await PDFDocument.load(await compile_fn(
            generate_typst_blank(request, {kind: 'alternating', binding: 'right'}), request.assets)),
    }

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
            // Copy the blank variant matching this insertion's true position
            const binding = binding_for_page(final_doc.getPageCount() + 1)
            const [page] = await final_doc.copyPages(blank_doc[binding], [0])
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

        // Half-blank passages pin their content to a fixed physical side for the whole run
        // (see half_blank_content_side) rather than alternating by absolute position — content
        // must stay on the same side as its facing notes page throughout
        const half_blank_side = item.type === 'passage' ? half_blank_content_side(item.half_blank) : null
        const margin_mode:MarginMode|undefined = half_blank_side
            ? {kind: 'fixed', side: half_blank_side}
            : undefined

        // Compile the item as its own document. The start page keeps the page counter
        // continuous with what's already been assembled, since each section is its own Typst
        // compile (its internal counter would otherwise restart at 1)
        const item_doc = await compile_item(
            request, item, compile_fn, final_doc.getPageCount() + 1, margin_mode,
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


// Preview strip geometry (points): base type sizes, the gap between the two lines, and the
// padding around the text block. Type shrinks below the base sizes on narrow pages so the
// longer line always fits; the strip height then follows the text.
const PREVIEW_STRIP_TITLE_SIZE = 13
const PREVIEW_STRIP_SUBTITLE_SIZE = 9.5
const PREVIEW_STRIP_LINE_GAP = 6
const PREVIEW_STRIP_PADDING = 11

// Light orange fill so the strip reads as a notice rather than a page of content
const PREVIEW_STRIP_FILL = rgb(0.996, 0.925, 0.82)


// Add a short two-line notice strip to a preview PDF — position 'start' prepends it as page 1
// ("this is only a preview"), 'end' appends it as the last page ("end of preview"). The strip
// is 80% of a trim page wide and only tall enough for its text plus padding, on a light orange
// ground, so it reads as a note rather than a page of content. Called after every other
// assembly step (cover merge included) so it always lands at the very edge of the document, in
// every view and section. Text is passed in already translated (this package has no i18n).
export async function add_preview_strip(
    pdf_bytes:Uint8Array, page_width:string, title:string, subtitle:string,
    position:'start'|'end',
):Promise<Uint8Array> {

    const doc = await PDFDocument.load(pdf_bytes)
    const {num, unit} = parse_unit(page_width)
    const width = to_pt(num, unit) * 0.8

    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    // Shrink the type if the wider of the two lines wouldn't fit within the padded width
    let title_size = PREVIEW_STRIP_TITLE_SIZE
    let subtitle_size = PREVIEW_STRIP_SUBTITLE_SIZE
    let line_gap = PREVIEW_STRIP_LINE_GAP
    const natural = Math.max(
        bold.widthOfTextAtSize(title, title_size),
        regular.widthOfTextAtSize(subtitle, subtitle_size),
    )
    const available = width - PREVIEW_STRIP_PADDING * 2
    if (natural > available){
        const shrink = available / natural
        title_size *= shrink
        subtitle_size *= shrink
        line_gap *= shrink
    }

    const block_height = title_size + line_gap + subtitle_size
    const height = block_height + PREVIEW_STRIP_PADDING * 2

    const page = position === 'start'
        ? doc.insertPage(0, [width, height])
        : doc.addPage([width, height])
    page.drawRectangle({x: 0, y: 0, width, height, color: PREVIEW_STRIP_FILL})

    let y = height - PREVIEW_STRIP_PADDING - title_size
    page.drawText(title, {
        x: (width - bold.widthOfTextAtSize(title, title_size)) / 2,
        y,
        size: title_size,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
    })
    y -= line_gap + subtitle_size
    page.drawText(subtitle, {
        x: (width - regular.widthOfTextAtSize(subtitle, subtitle_size)) / 2,
        y,
        size: subtitle_size,
        font: regular,
        color: rgb(0.3, 0.3, 0.3),
    })

    return doc.save()
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
// margin_mode overrides the default alternating-by-parity margins (see half_blank_content_side).
async function compile_item(
    request:TypstRequest, item:TypstContentItem, compile_fn:CompileFn, start_page:number,
    margin_mode?:MarginMode,
):Promise<PDFDocument> {
    const source = generate_typst(make_item_request(request, item), start_page, margin_mode)
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

    // The facing side is always the opposite of content's fixed side (see
    // half_blank_content_side) — never alternating, since the notes page must stay on the same
    // physical side as its facing content throughout the whole passage
    const content_side = half_blank_content_side(passage.half_blank)!
    const facing_side:'left'|'right' = content_side === 'left' ? 'right' : 'left'
    const facing_mode:MarginMode = {kind: 'fixed', side: facing_side}

    // Ruled lines on the facing side (reused for every page — one fixed-side compile, since
    // every facing page sits on the same physical side); otherwise a plain blank
    let lines_doc:PDFDocument|null = null
    if (passage.show_lines) {
        lines_doc = await PDFDocument.load(
            await compile_fn(generate_typst_lines(request, '10mm', facing_mode), request.assets))
    }

    // Ensure the pair starts on the correct page for book-like arrangement
    if (booklike && final_doc.getPageCount() % 2 !== 1) {
        await add_blank()
    }

    // Add the facing (blank or lines) side — a fixed-side blank when there are no ruled lines
    // (skipped in 'normal' arrangement, same as generic add_blank(), since the generic variant
    // picks by absolute parity and doesn't apply to this fixed-side facing page)
    let facing_blank:PDFDocument|null = null
    const add_facing = async () => {
        if (lines_doc) {
            await add_page(lines_doc, 0, false)
        } else if (booklike) {
            facing_blank ??= await PDFDocument.load(
                await compile_fn(generate_typst_blank(request, facing_mode), request.assets))
            await add_page(facing_blank, 0, false)
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


// Apply booklet imposition: reorder pages for fold-at-home 2-up printing.
async function apply_booklet(
    assembled_doc:PDFDocument, request:TypstRequest, blank_doc:BlankVariants, preview = false,
):Promise<Uint8Array> {

    // Ensure page count is a multiple of 4 (a physical folded sheet holds 4 pages). Previews
    // aren't printed, so they only pad to even — just enough for the 2-up pairing below.
    const page_count = assembled_doc.getPageCount()
    const target_count = preview
        ? Math.ceil(page_count / 2) * 2
        : Math.ceil(page_count / 4) * 4

    // Pad with compiled blank pages if needed (must have a content stream so they can be
    // embedded below — a bare pdf-lib addPage() has no Contents and fails to embed). Each padded
    // page picks the binding variant matching its own absolute position, not just the first
    if (target_count > page_count) {
        for (let i = page_count; i < target_count; i++) {
            const binding = binding_for_page(i + 1)
            const [page] = await assembled_doc.copyPages(blank_doc[binding], [0])
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


// Create a modified request holding only one content item (for isolated compilation). The
// outer assemble pass handles page arrangement, so it is forced to 'normal' here.
function make_item_request(request:TypstRequest, item:TypstContentItem):TypstRequest {
    return {
        ...request,
        content: [item],
        arrangement: 'normal',
    }
}
