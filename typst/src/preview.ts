
// Preview-only truncation of a TypstRequest, so on-screen previews of very large documents
// (e.g. a whole bible) compile fast rather than rendering every page. All of this is
// deliberately rough — a preview just needs to look right, not paginate exactly.
//
// The one hard rule: never clip the START of a book/passage. Truncation only ever drops
// whole content items and, at most, cuts the TAIL off the last kept passage. Each item
// compiles as its own Typst document (see assemble_pages), so a book whose start is intact
// lays out its pages exactly as in the real document — only the dropped items and the
// running page numbers change. Clipping a book's start or middle would reflow it and shift
// every page after it.

import {escape_typst} from './helpers.js'

import type {TypstRequest, TypstContentItem, TypstCustomPage} from './types.js'


// Very rough estimate of how many characters of markup fill one printed page
const ROUGH_PAGE_CHARS = 3000

// Character budget for a preview compile: roughly 50 pages of content. Documents under this
// render in full; anything larger keeps a window of whole items (see truncate_for_preview)
export const PREVIEW_CHAR_LIMIT = ROUGH_PAGE_CHARS * 50


// Which portion of an over-long document the preview window should show
export type PreviewSection = 'start'|'middle'|'end'


// Text for the truncation notice pages, provided by the caller so it can be translated
export interface PreviewMessages {
    start_title:string  // Title of the leading page when content before the window was cut
    end_title:string    // Title of the trailing page when content after the window was cut
    detail:string       // Explanatory line shown on both pages
}


// Result of truncating a request for preview. truncated is false when the document fit within
// the budget and the original request was returned untouched.
export interface PreviewTruncation {
    request:TypstRequest
    truncated:boolean
    // Rough character weight of the whole document and of the kept preview window (equal when
    // not truncated) — callers scale the preview's compiled page count by total/window to
    // estimate the full document's page count (e.g. for cover spine width)
    total_chars:number
    window_chars:number
}


// Rough size of one content item in characters. Passages count their largest translation
// (multiple translations lay out side-by-side/interleaved, so the longest one drives page
// count); title and lines pages count as about a page's worth.
function item_weight(item:TypstContentItem):number {
    if (item.type === 'passage') {
        return Math.max(0, ...item.bibles.map(bible => bible.content.length))
    }
    if (item.type === 'custom') {
        return item.content.length
    }
    return ROUGH_PAGE_CHARS
}


// Keep whole paragraph blocks (split on blank lines) from the start of the markup up to
// roughly `limit` characters — always from char 0, so a book's opening layout is never
// disturbed. A block straddling the limit is kept whole, so the result may run slightly past.
function clip_markup_tail(content:string, limit:number):string {
    const blocks = content.split('\n\n')
    const kept:string[] = []
    let pos = 0
    for (const block of blocks) {
        if (pos >= limit) {
            break
        }
        kept.push(block)
        pos += block.length + 2  // Account for the removed '\n\n' separator
    }
    return kept.join('\n\n')
}


// A simple centred page telling the user the preview was cut short here and the full document
// will have the rest
function gen_notice_page(title:string, detail:string):TypstCustomPage {
    const content = `#align(center)[
#text(size: 1.5em)[*${escape_typst(title)}*]

${escape_typst(detail)}
]`
    return {type: 'custom', content, position: 'middle'}
}


// Walk items forward from `start`, keeping whole items while they fit `budget`. The first item
// that overflows is tail-clipped and kept if it's a passage (so the window still fills the
// budget); otherwise it's left out. Always keeps at least the item at `start`, even if that
// one item exceeds the budget on its own (a single huge book — shown from its start, tail cut).
// Returns the exclusive end index and whether the last kept item needs its tail clipped.
function grow_forward(
    content:TypstContentItem[], weights:number[], start:number, budget:number,
):{end:number, clip_last:boolean} {
    let used = 0
    for (let i = start; i < content.length; i++) {
        if (used + weights[i]! <= budget) {
            used += weights[i]!
            continue
        }
        // This item overflows. Tail-clip it if it's a clippable passage with room left;
        // if it's the anchor itself, clip it regardless so the window is never empty.
        if (content[i]!.type === 'passage' && (budget - used > 0 || i === start)) {
            return {end: i + 1, clip_last: true}
        }
        // Non-clippable overflow (title/lines/custom/story): keep it whole if it's the anchor,
        // otherwise stop before it
        return i === start ? {end: i + 1, clip_last: false} : {end: i, clip_last: false}
    }
    return {end: content.length, clip_last: false}
}


// Walk items backward from `end` (exclusive), keeping whole items while they fit `budget`.
// Never clips — a book's start must stay intact, so the earliest kept item is always whole.
// Always keeps at least the last item (the one at end - 1).
function grow_backward(weights:number[], end:number, budget:number):number {
    let used = 0
    let lo = end - 1
    for (let i = end - 1; i >= 0; i--) {
        if (i < end - 1 && used + weights[i]! > budget) {
            break
        }
        used += weights[i]!
        lo = i
    }
    return lo
}


// Reduce a request to a preview-sized window of its content. Small documents pass through
// untouched. Larger ones keep a run of whole items positioned by `section` — 'start' from the
// document start, 'end' the trailing items, 'middle' outward from the item holding the
// midpoint — with only the last kept passage ever tail-clipped to hit the budget. A notice
// page marks each side where whole items were dropped (or the tail was cut), set as
// request.preview_front/preview_rear so the PDF pipeline can place them after page arrangement.
export function truncate_for_preview(
    request:TypstRequest, section:PreviewSection, messages:PreviewMessages,
):PreviewTruncation {

    const content = request.content
    const count = content.length
    const weights = content.map(item_weight)
    const total = weights.reduce((sum, weight) => sum + weight, 0)

    // Whole document fits the budget — nothing to do
    if (total <= PREVIEW_CHAR_LIMIT) {
        return {request, truncated: false, total_chars: total, window_chars: total}
    }

    // Pick the kept run [lo, hi) of whole items, and whether content[hi - 1] is tail-clipped
    let lo:number
    let hi:number
    let clip_last:boolean

    if (section === 'end') {
        // Trailing whole items only — the first kept item's start must stay intact
        lo = grow_backward(weights, count, PREVIEW_CHAR_LIMIT)
        hi = count
        clip_last = false
    } else {
        // 'start' anchors on item 0; 'middle' on the item holding the midpoint character
        // (stepped back to the nearest passage so the window opens on real content)
        let anchor = 0
        if (section === 'middle') {
            const midpoint = total / 2
            let acc = 0
            anchor = count - 1
            for (let i = 0; i < count; i++) {
                acc += weights[i]!
                if (acc > midpoint) {
                    anchor = i
                    break
                }
            }
            while (anchor > 0 && content[anchor]!.type !== 'passage') {
                anchor -= 1
            }
        }
        lo = anchor
        const grown = grow_forward(content, weights, anchor, PREVIEW_CHAR_LIMIT)
        hi = grown.end
        clip_last = grown.clip_last
    }

    // Assemble the kept slice, tail-clipping the final passage if needed. clip_markup_tail
    // always keeps from char 0, so the clipped book's opening pages are untouched.
    const budget_before_last = weights.slice(lo, hi - 1).reduce((sum, weight) => sum + weight, 0)
    const tail_room = Math.max(0, PREVIEW_CHAR_LIMIT - budget_before_last)
    const kept:TypstContentItem[] = content.slice(lo, hi).map((item, index) => {
        const is_last = index === hi - lo - 1
        if (!is_last || !clip_last || item.type !== 'passage') {
            return item
        }
        const source_weight = weights[hi - 1]!
        const bibles = item.bibles.map(bible => {
            const scale = source_weight > 0 ? bible.content.length / source_weight : 0
            return {content: clip_markup_tail(bible.content, Math.ceil(tail_room * scale))}
        })
        return {...item, bibles}
    })

    // Notice pages: front when whole items were dropped before the window, rear when items
    // were dropped after it or the last kept passage was cut short
    const truncated_request:TypstRequest = {...request, content: kept}
    if (lo > 0) {
        truncated_request.preview_front = gen_notice_page(messages.start_title, messages.detail)
    }
    if (hi < count || clip_last) {
        truncated_request.preview_rear = gen_notice_page(messages.end_title, messages.detail)
    }

    // Recomputed from the kept items (a tail-clipped passage weighs less), so page-count
    // estimates scale by what actually got compiled
    const window_chars = kept.reduce((sum, item) => sum + item_weight(item), 0)
    return {request: truncated_request, truncated: true, total_chars: total, window_chars}
}
