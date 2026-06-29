
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

    // Generate each content item
    const booklike = request.arrangement !== 'normal'

    for (let i = 0; i < request.content.length; i++) {
        const item = request.content[i]!

        // Page arrangement: ensure alone items start on an even page (recto)
        if (booklike && is_alone(item) && i > 0) {
            parts.push('#pagebreak(to: "even")')
        } else if (i > 0) {
            // Standard page break between content items
            parts.push('#pagebreak()')
        }

        // Render the content item
        parts.push(gen_content_item(item, request))

        // For alone items in book mode, ensure the next item starts on a new sheet
        if (booklike && is_alone(item)) {
            parts.push('#pagebreak(to: "even")')
        }
    }

    return parts.join('\n\n')
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
