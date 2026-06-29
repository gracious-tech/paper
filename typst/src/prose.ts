
// Convert a custom-page ProseMirror/Tiptap document to Typst markup via the generic
// pm-to-typst renderer (which natively handles the marks/nodes the app's editor uses,
// including subscript, superscript, and paragraph/heading text alignment).

import {pm_to_typst} from 'pm-to-typst'
import {escape_typst} from 'typst-utils'

import type {PmDoc} from 'pm-to-typst'


// Marker users can place in custom content to auto-insert the generated copyright statement
export const COPYRIGHT_MARKER = 'AUTO-COPYRIGHT'


// Replace the copyright marker in already-converted Typst markup with the given block.
// The marker survives `pm_to_typst` in escaped form (the hyphen becomes `\-`), so the
// search must target the escaped string rather than the raw marker.
export function replace_copyright_marker(markup:string, block:string):string {
    return markup.split(escape_typst(COPYRIGHT_MARKER)).join(block)
}


// Convert a full custom-page document to Typst markup
export function prose_to_typst(doc:PmDoc|undefined):string {
    if (!doc) {
        return ''
    }
    return pm_to_typst(doc)
}


// Whether a document contains the auto-copyright marker anywhere in its text
export function doc_has_copyright(doc:PmDoc|undefined):boolean {
    if (!doc) {
        return false
    }
    if (doc.type === 'text' && doc.text?.includes(COPYRIGHT_MARKER)) {
        return true
    }
    return (doc.content ?? []).some(child => doc_has_copyright(child))
}
