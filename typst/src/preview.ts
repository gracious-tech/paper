
// Preview-only truncation of a TypstRequest, so on-screen previews of very large documents
// (e.g. a whole bible) compile fast rather than rendering every page. All of this is
// deliberately rough — a preview just needs to look right, not paginate exactly.

import {escape_typst} from './helpers.js'

import type {TypstRequest, TypstContentItem, TypstCustomPage} from './types.js'


// Very rough estimate of how many characters of markup fill one printed page
const ROUGH_PAGE_CHARS = 3000

// Character budget for a preview compile: roughly 50 pages of content. Documents under this
// render in full; anything larger gets a window into it (see truncate_for_preview)
export const PREVIEW_CHAR_LIMIT = ROUGH_PAGE_CHARS * 50


// Which portion of an over-long document the preview window should show
export type PreviewSection = 'start'|'middle'|'end'


// Text for the trailing "End of preview" page, provided by the caller so it can be translated
export interface PreviewMessages {
    title:string
    detail:string
}


// Result of truncating a request for preview. truncated is false when the document fit within
// the budget and the original request was returned untouched.
export interface PreviewTruncation {
    request:TypstRequest
    truncated:boolean
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


// Cut markup down to roughly the [start, end) character window, keeping whole paragraph blocks
// (split on blank lines) so the result stays compilable Typst. Blocks that overlap the window
// at all are kept whole, so the result may run slightly past either edge — fine for a preview.
function cut_markup(content:string, start:number, end:number):string {
    const blocks = content.split('\n\n')
    const kept:string[] = []
    let pos = 0
    for (const block of blocks) {
        const block_end = pos + block.length
        if (block_end > start && pos < end) {
            kept.push(block)
        }
        pos = block_end + 2  // Account for the removed '\n\n' separator
    }
    return kept.join('\n\n')
}


// A simple centred page telling the user the preview stops here and the full document will
// have the rest
function gen_end_page(messages:PreviewMessages):TypstCustomPage {
    const content = `#align(center)[
#text(size: 1.5em)[*${escape_typst(messages.title)}*]

${escape_typst(messages.detail)}
]`
    return {type: 'custom', content, position: 'middle', new_page: true}
}


// Reduce a request to a preview-sized window of its content. Small documents pass through
// untouched; large ones keep only the items (and partial passages, cut at paragraph
// boundaries) that fall within a PREVIEW_CHAR_LIMIT window positioned by `section`, with an
// "End of preview" page appended whenever content after the window was dropped.
export function truncate_for_preview(
    request:TypstRequest, section:PreviewSection, messages:PreviewMessages,
):PreviewTruncation {

    // Whole document fits the budget — nothing to do
    const weights = request.content.map(item_weight)
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (total <= PREVIEW_CHAR_LIMIT) {
        return {request, truncated: false}
    }

    // Character offset the window starts at, per section
    let offset = 0
    if (section === 'middle') {
        offset = Math.floor((total - PREVIEW_CHAR_LIMIT) / 2)
    } else if (section === 'end') {
        offset = total - PREVIEW_CHAR_LIMIT
    }
    const window_end = offset + PREVIEW_CHAR_LIMIT

    // Keep items that intersect the window; passages that straddle a window edge are cut at
    // paragraph boundaries (each translation cut at the same proportional position)
    const kept:TypstContentItem[] = []
    let pos = 0
    for (const [index, item] of request.content.entries()) {
        const weight = weights[index]!
        const item_start = pos
        const item_end = pos + weight
        pos = item_end

        // Entirely outside the window
        if (item_end <= offset || item_start >= window_end) {
            continue
        }

        // Passage straddling a window edge — cut its content; everything else is kept whole
        if (item.type === 'passage' && (item_start < offset || item_end > window_end)) {
            const local_start = Math.max(0, offset - item_start)
            const local_end = Math.min(weight, window_end - item_start)
            const bibles = item.bibles.map(bible => {
                const scale = weight > 0 ? bible.content.length / weight : 0
                return {content: cut_markup(bible.content,
                    Math.floor(local_start * scale), Math.ceil(local_end * scale))}
            })
            kept.push({...item, bibles})
        } else {
            kept.push(item)
        }
    }

    // Tell the user the preview was cut short (unless the window reaches the document's end)
    if (window_end < total) {
        kept.push(gen_end_page(messages))
    }

    return {request: {...request, content: kept}, truncated: true}
}
