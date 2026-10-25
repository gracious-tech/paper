
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

import type {TypstRequest, TypstContentItem} from './types.js'


// Very rough estimate of how many characters of markup fill one printed page
const ROUGH_PAGE_CHARS = 3000

// Character budget for a preview compile: roughly 50 pages of content. Documents under this
// render in full; anything larger keeps a window of whole items (see truncate_for_preview)
export const PREVIEW_CHAR_LIMIT = ROUGH_PAGE_CHARS * 50

// Smaller budget for a window compiled only to estimate the page count (mobile, where no preview
// is shown), since memory and time are what old phones run out of. Not smaller: each kept book's
// fixed overhead (title page, chapter-1 layout) is scaled up with the window, and at ~20 pages
// that overestimated Genesis by 13% where ~30 pages comes within 2%
export const ESTIMATE_CHAR_LIMIT = ROUGH_PAGE_CHARS * 30


// Which portion of an over-long document the preview window should show
export type PreviewSection = 'start'|'middle'|'end'


// Which device a preview is for: a phone's is the smaller window, from the start only
export type PreviewSize = 'phone'|'desktop'


// The character budget of each size of preview
export const PREVIEW_LIMITS:Record<PreviewSize, number> = {
    phone: ESTIMATE_CHAR_LIMIT,
    desktop: PREVIEW_CHAR_LIMIT,
}


// A preview as the app shows it, whether its browser or the server made it: the window's pages
// in reading order, each a standalone SVG document, and the cover when the window starts at the
// book's start (else none) — a phone's as its front and back panels, a desktop's as the whole
// wraparound, cropped to its trim box with its folds marked (see crop_cover_svg)
export interface PreviewPages {
    pages:string[]
    covers:string[]
}


// Result of truncating a request for preview. truncated is false when the document fit within
// the budget and the original request was returned untouched.
export interface PreviewTruncation {
    request:TypstRequest
    truncated:boolean
    // Whether whole items were dropped before / after the kept window. dropped_after also
    // covers the last kept passage having its tail cut. Neither adds a page inside the
    // compiled PDF — the app surfaces both as short strips prepended/appended to the preview.
    dropped_before:boolean
    dropped_after:boolean
    // Rough character weight of the whole document and of the kept preview window (equal when
    // not truncated) — callers scale the preview's compiled page count by total/window to
    // estimate the full document's page count (e.g. for cover spine width)
    total_chars:number
    window_chars:number
}


// Rough size of one content item in characters. Passages count every translation, since each
// one is typeset in full whatever the layout, so a bilingual window costs the compile about what
// a monolingual one does; title and lines pages count as about a page's worth.
function item_weight(item:TypstContentItem):number {
    if (item.type === 'passage') {
        return item.bibles.reduce((sum, bible) => sum + bible.content.length, 0)
    }
    if (item.type === 'custom') {
        return item.content.length
    }
    return ROUGH_PAGE_CHARS
}


// Net count of content brackets opened by a piece of markup. Escaped brackets (`\[`, `\]`) are
// text, not delimiters, so the character after a backslash is skipped
function bracket_depth(text:string):number {
    let depth = 0
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === '\\') {
            i += 1
        } else if (char === '[') {
            depth += 1
        } else if (char === ']') {
            depth -= 1
        }
    }
    return depth
}


// Split markup after each blank line, so every piece keeps the blank line that ended it. Done by
// hand because a lookbehind (`/(?<=\n\n)/`) is a syntax error in Safari before 16.4, which
// fails to parse the whole bundle and leaves older iPhones on the loading screen
function split_after_blank_lines(content:string):string[] {
    const parts:string[] = []
    let start = 0
    let blank = content.indexOf('\n\n')
    while (blank !== -1) {
        // Cut after this blank line's second newline, never at the very end (as split() doesn't)
        const cut = blank + 2
        if (cut >= content.length) {
            break
        }
        parts.push(content.slice(start, cut))
        start = cut
        blank = content.indexOf('\n\n', blank + 1)
    }
    parts.push(content.slice(start))
    return parts
}


// Rejoin consecutive parts (which concatenate back to the original markup) so that a cut
// remains only where every `[` opened before it has closed. Study notes span blank lines
// (`#studynote[...\n\n]`), so a cut at any blank line could otherwise end the markup inside
// one, failing the compile with "unclosed delimiter"
function split_balanced(parts:string[]):string[] {
    const pieces:string[] = []
    let depth = 0
    for (const part of parts) {
        if (depth > 0 && pieces.length) {
            pieces[pieces.length - 1] += part
        } else {
            pieces.push(part)
        }
        depth += bracket_depth(part)
    }
    return pieces
}


// Keep whole paragraph blocks (split after blank lines) from the start of the markup up to
// roughly `limit` characters — always from char 0, so a book's opening layout is never
// disturbed. A block straddling the limit is kept up to its last chapter start that fits (see
// clip_block_chapters), so the result may run slightly past.
function clip_markup_tail(content:string, limit:number):string {
    let kept = ''
    for (const block of split_balanced(split_after_blank_lines(content))) {
        if (kept.length >= limit) {
            break
        }
        if (kept.length + block.length > limit) {
            kept += clip_block_chapters(block, limit - kept.length)
            break
        }
        kept += block
    }
    // Blocks carry the blank line that followed them, which the clipped tail doesn't need
    return kept.replace(/\n\n$/, '')
}


// Keep whole chapters (split on the #ch(n) marker lines, the same safe cut split_chapters()
// uses) from the start of one block up to roughly `limit` characters, always keeping the first.
// Needed because poetry markup separates its lines with single newlines: the KJV's Psalms is
// one 300k-character block, which kept whole made the "~50 page" window the entire book
function clip_block_chapters(block:string, limit:number):string {
    let kept = ''
    for (const chapter of split_balanced(block.split(/(?=^#ch\(\d+\))/m))) {
        if (kept && kept.length + chapter.length > limit) {
            break
        }
        kept += chapter
    }
    return kept
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
// midpoint — with only the last kept passage ever tail-clipped to hit the budget. The result's
// dropped_before/dropped_after flags say which sides lost content; the app renders each as a
// short note at the front/back of the preview. `limit` is the character budget (see
// PREVIEW_LIMITS, or ESTIMATE_CHAR_LIMIT for an estimate-only compile).
export function truncate_for_preview(
    request:TypstRequest, section:PreviewSection, limit = PREVIEW_CHAR_LIMIT,
):PreviewTruncation {

    const content = request.content
    const count = content.length
    const weights = content.map(item_weight)
    const total = weights.reduce((sum, weight) => sum + weight, 0)

    // Whole document fits the budget — nothing to do
    if (total <= limit) {
        return {
            request, truncated: false, dropped_before: false, dropped_after: false,
            total_chars: total, window_chars: total,
        }
    }

    // Pick the kept run [lo, hi) of whole items, and whether content[hi - 1] is tail-clipped
    let lo:number
    let hi:number
    let clip_last:boolean

    if (section === 'end') {
        // Trailing whole items only — the first kept item's start must stay intact
        lo = grow_backward(weights, count, limit)
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
        const grown = grow_forward(content, weights, anchor, limit)
        hi = grown.end
        clip_last = grown.clip_last
    }

    // Assemble the kept slice, tail-clipping the final passage if needed. clip_markup_tail
    // always keeps from char 0, so the clipped book's opening pages are untouched.
    const budget_before_last = weights.slice(lo, hi - 1).reduce((sum, weight) => sum + weight, 0)
    const tail_room = Math.max(0, limit - budget_before_last)
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

    // Both a cut before and a cut after the window are surfaced by the app as short strips
    // added around the compiled preview — nothing is inserted into the content here
    const dropped_before = lo > 0
    const dropped_after = hi < count || clip_last
    // Pinning the final item only means anything while that item is still the window's last —
    // otherwise the preview would pin whichever item the cut happened to leave at the end
    const truncated_request:TypstRequest = {...request, content: kept,
        last_item_at_end: request.last_item_at_end && !dropped_after,
        preview_clipped: dropped_after}

    // Recomputed from the kept items (a tail-clipped passage weighs less), so page-count
    // estimates scale by what actually got compiled
    const window_chars = kept.reduce((sum, item) => sum + item_weight(item), 0)
    return {
        request: truncated_request, truncated: true, dropped_before, dropped_after,
        total_chars: total, window_chars,
    }
}
