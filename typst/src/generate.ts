
import {gen_preamble} from './preamble.js'
import {gen_passage} from './content_passage.js'
import {gen_title} from './content_title.js'
import {gen_custom} from './content_custom.js'
import {gen_lines} from './content_lines.js'

import type {TypstRequest, TypstContentItem, TypstPassage} from './types.js'


// Generate a single Typst document string from a request
// This is the "inner" function — produces a compilable .typ file
// For features that need multi-document compilation (alternate interleaving, half-blank),
// use generate_pdf() instead which handles the full pipeline
export function generate_typst(request:TypstRequest):string {
    const parts:string[] = []

    // Document preamble (page, fonts, paragraph, footer)
    parts.push(gen_preamble(request))

    // Group items so that merged sections (new_page === false) share a page with the
    // section above — page breaks are inserted between groups only, never within a group
    const booklike = request.arrangement !== 'normal'
    const groups = group_content(request.content)

    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]!
        const head = group[0]!

        // Page arrangement: ensure alone items start on an even page (recto)
        if (booklike && is_alone(head) && gi > 0) {
            parts.push('#pagebreak(to: "even")')
        } else if (gi > 0) {
            // Standard page break between groups
            parts.push('#pagebreak()')
        }

        // Render every item in the group with no page break between them (they flow together)
        for (const item of group) {
            parts.push(gen_content_item(item, request))
        }

        // For alone items in book mode, ensure the next group starts on a new sheet
        if (booklike && is_alone(head)) {
            parts.push('#pagebreak(to: "even")')
        }
    }

    return parts.join('\n\n')
}


// Whether a passage is rendered as two separately-compiled, interleaved translations. Such
// passages aren't a single continuous document, so nothing can merge into or out of them.
export function passage_is_alternate(item:TypstContentItem):boolean {
    return item.type === 'passage' && item.bibles.length > 1 && item.multi_layout === 'alternate'
}


// Whether an item can flow inline (be merged with the section above or accept merged followers)
function is_inline(item:TypstContentItem):boolean {
    if (item.type === 'custom') {
        return true
    }
    if (item.type === 'passage') {
        return !passage_is_alternate(item)
    }
    return false
}


// Partition content into groups. A group is a leading item plus any following items with
// new_page === false that are allowed to merge into it (see is_inline). Titles, lines
// pages and alternate-translation passages are never mergeable heads or followers.
export function group_content(content:TypstContentItem[]):TypstContentItem[][] {
    const groups:TypstContentItem[][] = []

    for (const item of content) {
        const current = groups[groups.length - 1]
        const is_follower = (item.type === 'passage' || item.type === 'custom')
            && item.new_page === false
        const can_merge = is_follower && current !== undefined
            && is_inline(current[0]!) && is_inline(item)

        if (can_merge) {
            current!.push(item)
        } else {
            groups.push([item])
        }
    }

    return groups
}


// Generate a Typst document for a single passage with a single bible
// Used by generate_pdf() when compiling alternate translations separately
export function generate_typst_passage(
    request:TypstRequest, passage:TypstPassage, bible_index:number,
):string {
    const parts:string[] = []

    // Same preamble as the main document
    parts.push(gen_preamble(request))

    // Create a modified passage with only the selected bible
    const single_passage:TypstPassage = {
        ...passage,
        bibles: [passage.bibles[bible_index]!],
        multi_layout: 'columns',  // Single bible, so layout is irrelevant
    }

    parts.push(gen_content_item(single_passage, request))

    return parts.join('\n\n')
}


// Generate a minimal Typst document for a blank page (used in post-processing)
export function generate_typst_blank(request:TypstRequest):string {
    return `#set page(
    width: ${request.page.width},
    height: ${request.page.height},
    margin: (top: ${request.page.margin_top}, bottom: ${request.page.margin_bottom},
        left: ${request.page.margin_left}, right: ${request.page.margin_right}),
)`
}


// Generate a minimal Typst document for a lines page (used in post-processing)
export function generate_typst_lines(request:TypstRequest, spacing:string):string {
    return `${generate_typst_blank(request)}

${gen_lines({type: 'lines', spacing}, request.page)}`
}


// Render a single content item to Typst
function gen_content_item(item:TypstContentItem, request:TypstRequest):string {
    switch (item.type) {
        case 'passage':
            return gen_passage(item)
        case 'title':
            return gen_title(item, request.page)
        case 'custom':
            return gen_custom(item)
        case 'lines':
            return gen_lines(item, request.page)
    }
}


// Check if a content item should be on its own sheet
function is_alone(item:TypstContentItem):boolean {
    if (item.type === 'title') {
        return item.alone
    }
    if (item.type === 'passage') {
        return item.alone
    }
    return false
}
