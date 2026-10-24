
// Assembling the printed page sequence from its separately compiled parts, whatever the output.
//
// A document isn't one Typst compile: every content item compiles as its own document (so a
// passage's page counter and margins can be set from where it lands), and the sequence is then
// put together with blank padding, half-blank notes pages, facing-page passages split down the
// middle, and a pinned last page. That logic decides which page goes where, never what a page
// looks like, so it works on references to compiled pages and leaves turning them into output to
// a backend: pdf-lib for print (pdf_postprocess.ts), standalone SVGs for a phone's preview
// (svg_pages.ts). Both therefore show exactly the same pages in the same order.

import {generate_typst, generate_typst_facing, generate_typst_blank,
    generate_typst_lines, passage_is_alternate, half_blank_content_side} from './generate.js'
import {LINE_SPACING} from './content_lines.js'

import type {MarginMode} from './generate.js'
import type {TypstRequest, TypstContentItem, TypstPassage, TypstCustomPage, ProgressFn}
    from './types.js'


// How compiled Typst becomes pages in one kind of output. D is a compiled document
export interface PageBackend<D> {
    // Compile one Typst source (plus any assets it maps by filename)
    compile(source:string, assets?:Record<string, Uint8Array>):Promise<D>
    page_count(doc:D):number
    // A document of every page split down the middle into two pages of half the width, left
    // half first (see process_facing)
    split_halves(doc:D):Promise<D>
}


// One page of the assembled sequence: which compiled document, and which page of it
export interface PageRef<D> {
    doc:D
    index:number
}


// A blank/lines padding page's single compiled page gets reused at many different absolute
// positions, each with its own true parity — see generate_typst_blank's alternating MarginMode.
// Callers keep both pre-compiled variants and pick per-insertion via binding_for_page rather
// than recompiling on every use. Only for generic padding — half-blank notetaking pages use a
// single fixed-side compile instead (see process_faced), since their side never depends on
// absolute position
export interface BlankVariants<D> {
    left:D
    right:D
}


// The assembled sequence, plus what later steps need to pad or trim it
export interface Assembly<D> {
    pages:PageRef<D>[]
    blank:BlankVariants<D>
    // Whether each assembled page is a padding blank (lines pages count as content), so
    // preview arrangements can trim meaningless trailing blanks (see trim_trailing_blanks)
    blank_flags:boolean[]
}


// The binding a generic padding page at this 1-based absolute position needs to keep "inside"
// on the correct physical side — mirrors generate_typst's default start_page-parity logic
export function binding_for_page(page_number:number):'left'|'right' {
    return page_number % 2 === 1 ? 'left' : 'right'
}


// Build subjobs from content items, compile each, and assemble the printed page sequence
// (reading order, including all blank/note pages) — before any booklet imposition.
// hold_last leaves the final content item out, for a caller placing it itself once the padded
// length is known (see place_last_item)
export async function assemble_pages<D>(
    request:TypstRequest, backend:PageBackend<D>, on_progress?:ProgressFn, hold_last = false,
):Promise<Assembly<D>> {

    const booklike = request.arrangement !== 'normal'
    const items = hold_last ? request.content.slice(0, -1) : request.content

    // Compile both binding variants of the blank padding page — whichever absolute position
    // each padding page lands at (decided below, at insertion time) picks the matching one
    const blank:BlankVariants<D> = {
        left: await backend.compile(
            generate_typst_blank(request, {kind: 'alternating', binding: 'left'}), request.assets),
        right: await backend.compile(
            generate_typst_blank(request, {kind: 'alternating', binding: 'right'}), request.assets),
    }

    const pages:PageRef<D>[] = []
    const blank_flags:boolean[] = []

    // Helper: add a page to the sequence (null for a generic padding blank)
    async function add_page(source_doc:D|null, page_index:number) {
        if (source_doc === null) {
            if (!booklike) {
                return  // Skip blanks in 'normal' mode
            }
            // The blank variant matching this insertion's true position
            pages.push({doc: blank[binding_for_page(pages.length + 1)], index: 0})
        } else {
            pages.push({doc: source_doc, index: page_index})
        }
        blank_flags.push(source_doc === null)
    }

    // Helper: add a blank page
    async function add_blank() {
        await add_page(null, 0)
    }

    // Process each content item (each compiles as its own document)
    for (const [index, item] of items.entries()) {

        // Report each item as it starts (passages by their reference, so long documents show
        // per-passage progress)
        const label = item.type === 'passage' ? item.progress_label : `${item.type} page`
        on_progress?.({stage: 'compile', i: index + 1, total: request.content.length, label})

        // Facing-pages passage: both translations compiled together double-width, then split
        if (passage_is_alternate(item)) {
            await process_facing(item as TypstPassage, request, backend, pages.length, booklike,
                add_page, add_blank)
            continue
        }

        // titlepage_always forces every title page to start on the given side — a blank is
        // inserted first if the current page count doesn't already put the next page on that side
        const title_always = item.type === 'title' ? request.titlepage.always : null

        if (title_always && booklike) {
            // 0-indexed even page count so far -> next page lands recto/right (see the identical
            // convention in process_faced's half_blank handling below)
            const need_blank = title_always === 'right'
                ? pages.length % 2 === 1
                : pages.length % 2 === 0
            if (need_blank) {
                await add_blank()
            }
        }

        // titlepage.blank_back keeps the other side of a title's leaf blank. A title about to
        // land verso shares its leaf with the page before it, so unless that's already a blank,
        // two blanks keep the title verso with an empty recto behind it (a recto title is padded
        // after instead, see below)
        const blank_back = item.type === 'title' && request.titlepage.blank_back && booklike
        if (blank_back && pages.length % 2 === 1 && !blank_flags.at(-1)) {
            await add_blank()
            await add_blank()
        }

        // Half-blank passages pin their content to a fixed physical side for the whole run
        // (see half_blank_content_side) rather than alternating by absolute position — content
        // must stay on the same side as its facing notes page throughout
        const half_blank_side = item.type === 'passage'
            ? half_blank_content_side(item.half_blank) : null
        const margin_mode:MarginMode|undefined = half_blank_side
            ? {kind: 'fixed', side: half_blank_side}
            : undefined

        // Compile the item as its own document. The start page keeps the page counter
        // continuous with what's already been assembled, since each section is its own Typst
        // compile (its internal counter would otherwise restart at 1)
        const item_doc = await compile_item(request, item, backend, pages.length + 1, margin_mode)

        // Half-blank: face every page of the compiled passage with a blank/lines page
        if (item.type === 'passage' && item.half_blank !== null) {
            await process_faced(item_doc, item, request, backend, pages.length, booklike,
                add_page, add_blank)
            continue
        }

        // A lines page deliberately over-fills (see gen_lines) so it reaches the bottom of any
        // page size, spilling onto extra physical pages that must be discarded — only the first
        // is real content (same convention as the facing lines page in process_faced below)
        const page_limit = item.type === 'lines' ? 1 : backend.page_count(item_doc)
        for (let p = 0; p < page_limit; p++) {
            await add_page(item_doc, p)
        }

        // A title that ended on a recto page shares its leaf with the next page, so a blank
        // there keeps its back clear of anything that would show through the paper
        if (blank_back && pages.length % 2 === 1) {
            await add_blank()
        }
    }

    return {pages, blank, blank_flags}
}


// Remove the run of blank pages at the very end of an assembled document. Preview only —
// printed documents keep every padding page. Callers restore evenness where needed.
export function trim_trailing_blanks<D>(assembly:Assembly<D>):void {
    const {pages, blank_flags} = assembly
    while (pages.length > 1 && blank_flags[pages.length - 1]) {
        pages.pop()
        blank_flags.pop()
    }
}


// The content item to land on the document's physical last page, or null for the usual
// behaviour (padding blanks appended after the content). Only a text page qualifies — see
// Blueprint.last_item_at_end for why a passage is deliberately left unpinnable
export function pin_last_item(request:TypstRequest):TypstCustomPage|null {
    if (!request.last_item_at_end) {
        return null
    }
    const last = request.content[request.content.length - 1]
    return last?.type === 'custom' ? last : null
}


// How many pages one physical unit of an arrangement holds — the multiple the assembled page
// count gets padded up to. A printed booklet's folded sheet carries 4; previews only need
// recto/verso parity, and a book is only padded at all on screen (see generate_pdf)
export function pad_multiple(arrangement:TypstRequest['arrangement'], preview:boolean):number {
    if (arrangement === 'booklet') {
        return preview ? 2 : 4
    }
    return arrangement === 'book' && preview ? 2 : 1
}


// Append padding blanks until the document reaches `target` pages, each picking the binding
// variant matching its own absolute position
export function add_blank_pages<D>(assembly:Assembly<D>, target:number):void {
    const {pages, blank, blank_flags} = assembly
    for (let page_number = pages.length + 1; page_number <= target; page_number++) {
        pages.push({doc: blank[binding_for_page(page_number)], index: 0})
        blank_flags.push(true)
    }
}


// Pad a document out to a whole number of physical units (see pad_multiple)
export function pad_pages<D>(assembly:Assembly<D>, multiple:number):void {
    add_blank_pages(assembly, Math.ceil(assembly.pages.length / multiple) * multiple)
}


// Place the pinned final item so the document ends on it, with the padding blanks that would
// otherwise have followed it inserted before it instead.
//
// This can only happen here, after everything else is assembled: an item's start page is baked
// into its compile — deciding both its printed page number and which physical side "inside"
// falls on (see generate_typst) — so a compiled page can't be shuffled to a new position
// afterwards. The item is therefore compiled on the assumption it takes a single page, which a
// text page effectively always does, and recompiled only if it turned out longer *and* that
// moved its start page. A multi-page item simply ends on the last page rather than filling it.
export async function place_last_item<D>(
    assembly:Assembly<D>, request:TypstRequest, backend:PageBackend<D>,
    pinned:TypstCustomPage, multiple:number,
):Promise<void> {

    // Where the item has to start for `count` pages of it to finish exactly on a padded boundary
    const assembled = assembly.pages.length
    const start_for = (count:number) =>
        Math.ceil((assembled + count) / multiple) * multiple - count + 1

    let start = start_for(1)
    let item_doc = await compile_item(request, pinned, backend, start)
    if (backend.page_count(item_doc) !== 1) {
        const corrected = start_for(backend.page_count(item_doc))
        if (corrected !== start) {
            start = corrected
            item_doc = await compile_item(request, pinned, backend, start)
        }
    }

    // The blanks it was pushed back by, then the item itself
    add_blank_pages(assembly, start - 1)
    for (let p = 0; p < backend.page_count(item_doc); p++) {
        assembly.pages.push({doc: item_doc, index: p})
        assembly.blank_flags.push(false)
    }
}


// Compile a single content item into its own document.
// start_page offsets the item's page counter so numbers stay continuous across sections.
// margin_mode overrides the default alternating-by-parity margins (see half_blank_content_side).
async function compile_item<D>(
    request:TypstRequest, item:TypstContentItem, backend:PageBackend<D>, start_page:number,
    margin_mode?:MarginMode,
):Promise<D> {
    const source = generate_typst(make_item_request(request, item), start_page, margin_mode)
    return await backend.compile(source, request.assets)
}


// Process a facing-pages passage: both translations lay out together as aligned rows on
// double-width pages (compiled once, so they can never drift apart), then every page splits
// down the centre cut — the primary translation lands on the verso and the second on the
// facing recto, each at the target trim size with full-width lines. `assembled` is the page
// count so far
async function process_facing<D>(
    passage:TypstPassage,
    request:TypstRequest,
    backend:PageBackend<D>,
    assembled:number,
    booklike:boolean,
    add_page:(doc:D|null, idx:number) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    // Start on a verso so each split pair reads as one open spread
    if (booklike && assembled % 2 !== 1) {
        await add_blank()
        assembled += 1
    }

    // The double-width footer prints each half's own final page number, so it needs the
    // starting page rather than a counter offset (the counter advances once per double page)
    const source = generate_typst_facing(request, passage, assembled + 1)
    const split_doc = await backend.split_halves(await backend.compile(source, request.assets))

    for (let p = 0; p < backend.page_count(split_doc); p++) {
        await add_page(split_doc, p)
    }
}


// Process a half-blank group — the compiled content doc on one side, a blank or lines page
// facing it. Blanks are added here, after the content is rendered, so merged items just extend
// the content document and get faced like any other page. `assembled` is the page count so far
async function process_faced<D>(
    content_doc:D,
    passage:TypstPassage,
    request:TypstRequest,
    backend:PageBackend<D>,
    assembled:number,
    booklike:boolean,
    add_page:(doc:D|null, idx:number) => Promise<void>,
    add_blank:() => Promise<void>,
):Promise<void> {

    // The facing side is always the opposite of content's fixed side (see
    // half_blank_content_side) — never alternating, since the notes page must stay on the same
    // physical side as its facing content throughout the whole passage
    const content_side = half_blank_content_side(passage.half_blank)!
    const facing_side:'left'|'right' = content_side === 'left' ? 'right' : 'left'
    const facing_mode:MarginMode = {kind: 'fixed', side: facing_side}

    // Ruled lines on the facing side (reused for every page — one fixed-side compile, since
    // every facing page sits on the same physical side); otherwise a plain blank
    let lines_doc:D|null = null
    if (passage.lines) {
        lines_doc = await backend.compile(
            generate_typst_lines(request, LINE_SPACING[passage.lines], facing_mode),
            request.assets)
    }

    // Ensure the pair starts on the correct page for book-like arrangement
    if (booklike && assembled % 2 !== 1) {
        await add_blank()
    }

    // Add the facing (blank or lines) side — a fixed-side blank when there are no ruled lines
    // (skipped in 'normal' arrangement, same as generic add_blank(), since the generic variant
    // picks by absolute parity and doesn't apply to this fixed-side facing page)
    let facing_blank:D|null = null
    const add_facing = async () => {
        if (lines_doc) {
            await add_page(lines_doc, 0)
        } else if (booklike) {
            facing_blank ??= await backend.compile(
                generate_typst_blank(request, facing_mode), request.assets)
            await add_page(facing_blank, 0)
        }
    }

    const content_is_left = passage.half_blank !== 'left'
    for (let p = 0; p < backend.page_count(content_doc); p++) {
        if (content_is_left) {
            await add_page(content_doc, p)
            await add_facing()
        } else {
            await add_facing()
            await add_page(content_doc, p)
        }
    }
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


// Assemble a request in reading order as a preview shows it: a folded booklet reads in the same
// sequential order as a book, so it's assembled as one (normal stays normal — it has no blank
// pages by design). It ends exactly where the printed document ends, padded to the *printed*
// arrangement's sheet (a folded booklet's 4, not the book it's read as here) — a trailing blank
// is a page the reader will really turn to, so hiding it made the preview disagree with the file
// that gets created. A clipped window is the exception: its last page isn't the document's last,
// so it's given no ending at all rather than an invented one
export async function assemble_reading_preview<D>(
    request:TypstRequest, backend:PageBackend<D>, on_progress?:ProgressFn,
):Promise<{assembly:Assembly<D>, reading_request:TypstRequest}> {
    const arrangement = request.arrangement === 'booklet' ? 'book' : request.arrangement
    const reading_request:TypstRequest = {...request, arrangement}

    const pinned = pin_last_item(request)
    const assembly = await assemble_pages(reading_request, backend, on_progress, !!pinned)

    if (request.preview_clipped) {
        trim_trailing_blanks(assembly)
    } else if (pinned) {
        await place_last_item(assembly, reading_request, backend, pinned,
            pad_multiple(request.arrangement, false))
    } else {
        pad_pages(assembly, pad_multiple(request.arrangement, false))
    }
    return {assembly, reading_request}
}
