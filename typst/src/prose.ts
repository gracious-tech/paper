
// Convert a custom-page ProseMirror/Tiptap document to Typst markup via the generic
// pm-to-typst renderer (which natively handles the marks/nodes the app's editor uses,
// including subscript, superscript, and paragraph/heading text alignment).

import {pm_to_typst, typst_renderer} from 'pm-to-typst'
import {escape_typst} from 'typst-utils'

import type {PmDoc, PmNode, RenderContext} from 'pm-to-typst'


// Marker users can place in custom content to auto-insert the generated copyright statement
export const COPYRIGHT_MARKER = 'AUTO-COPYRIGHT'


// Stand-in for a blank line the user typed (an empty paragraph). Typst renders an empty
// paragraph as nothing at all — and pm_to_typst collapses the blank markup lines it leaves
// behind — so the line would silently disappear. An empty box draws nothing but still occupies
// a line of its own, which is exactly one blank line's worth of advance
const BLANK_LINE = '#box()'


// Replace the copyright marker in already-converted Typst markup with the given block.
// The marker survives `pm_to_typst` in escaped form (the hyphen becomes `\-`), so the
// search must target the escaped string rather than the raw marker.
export function replace_copyright_marker(markup:string, block:string):string {
    return markup.split(escape_typst(COPYRIGHT_MARKER)).join(block)
}


// Render a paragraph, preserving an empty one as a blank line instead of dropping it
function render_paragraph_keeping_blanks(node:PmNode, ctx:RenderContext):string {
    if (!node.content?.length) {
        return BLANK_LINE
    }
    return typst_renderer.nodes.paragraph(node, ctx)
}


// Convert a full custom-page document to Typst markup. `blank_lines` keeps the empty paragraphs
// the user typed — wanted on a custom page, where the text is laid out as written, but not on a
// picture-story slide, where the text is centred in a fixed region of its own
export function prose_to_typst(doc:PmDoc|undefined, blank_lines = false):string {
    if (!doc) {
        return ''
    }
    if (!blank_lines) {
        return pm_to_typst(doc)
    }
    return pm_to_typst(doc, {nodes: {paragraph: render_paragraph_keeping_blanks}})
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
