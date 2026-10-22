
// Convert a custom-page ProseMirror/Tiptap document to Typst markup via the generic
// pm-to-typst renderer (which natively handles the marks/nodes the app's editor uses,
// including subscript, superscript, and paragraph/heading text alignment).

import {pm_to_typst, typst_renderer} from 'pm-to-typst'
import {escape_typst} from 'typst-utils'

import {detect_dir} from './lang.js'

import type {NodeHandler, PmDoc, PmNode, RenderContext} from 'pm-to-typst'
import type {TextDir} from './types.js'


// Marker users can place in custom content to auto-insert the generated copyright statement
export const COPYRIGHT_MARKER = 'AUTO-COPYRIGHT'


// Stand-in for a blank line the user typed (an empty paragraph). Typst renders an empty
// paragraph as nothing at all — and pm_to_typst collapses the blank markup lines it leaves
// behind — so the line would silently disappear. An empty box draws nothing but still occupies
// a line of its own, which is exactly one blank line's worth of advance
const BLANK_LINE = '#box();'


// Every embedded expression these handlers emit ends in `;`, as pm-to-typst's own do: Typst
// consumes it without printing it, and without it whatever follows (`(`, `[` or `.ident`) would be
// read as call arguments or a field access continuing the expression


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


// Wrap a block handler so its block takes the direction of its own text (see detect_dir),
// falling back to the page's when it has no letters to go by. The set rule has to enclose the
// whole block: Typst takes a paragraph's direction from the styles all of its content shares, so
// a rule that only covered the text would leave the paragraph laid out the page's way
function with_block_dir(handler:NodeHandler, page_dir:TextDir):NodeHandler {
    return (node, ctx) => {
        const dir = detect_dir(collect_prose_text(node)) ?? page_dir
        let markup = handler(node, ctx)
        // pm-to-typst skips 'left' as the default alignment, which it only is in LTR text — an
        // RTL block left-aligned by the user needs it spelled out. The editor's own default is no
        // alignment at all, so a stored 'left' is always the user's choice
        if (dir === 'rtl' && node.attrs?.['textAlign'] === 'left') {
            markup = `#align(left)[${markup}];`
        }
        // Newline after the set rule so a heading's `=` still opens a line
        return dir === page_dir ? markup : `#[#set text(dir: ${dir})\n${markup}\n];`
    }
}


// The direction a document's text is laid out in as a whole: that of its first letter (see
// detect_dir), else the direction it's placed into. Exported so the editor can show the text the
// same way it'll print
export function resolve_prose_dir(doc:PmDoc|undefined, inherited:TextDir):TextDir {
    return detect_dir(prose_to_text(doc)) ?? inherited
}


// Convert a full custom-page document to Typst markup. `blank_lines` keeps the empty paragraphs
// the user typed — wanted on a custom page, where the text is laid out as written, but not on a
// picture-story slide, where the text is centred in a fixed region of its own.
//
// `inherited` is the direction of what the text is placed into (the document's). Each paragraph
// and heading takes the direction of its own text, so an English introduction in an Arabic
// booklet (or an Arabic dedication on an English page) reads the right way without the user
// having to ask
export function prose_to_typst(
    doc:PmDoc|undefined, blank_lines = false, inherited:TextDir = 'ltr',
):string {
    if (!doc) {
        return ''
    }
    const page_dir = resolve_prose_dir(doc, inherited)
    const paragraph = blank_lines ? render_paragraph_keeping_blanks : typst_renderer.nodes.paragraph
    const markup = pm_to_typst(doc, {nodes: {
        paragraph: with_block_dir(paragraph, page_dir),
        heading: with_block_dir(typst_renderer.nodes.heading, page_dir),
    }})
    return page_dir === inherited ? markup : `#[#set text(dir: ${page_dir})\n${markup}\n];`
}


// Node types that occupy a line of their own, so their text mustn't run into the next node's
const BLOCK_NODES = new Set(
    ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule'])


// Collect a node's plain text, separating blocks with a space (inline runs join seamlessly, so
// a bolded word mid-sentence doesn't gain spaces around it)
function collect_prose_text(node:PmNode):string {
    if (node.type === 'text') {
        return node.text ?? ''
    }
    const inner = (node.content ?? []).map(child => collect_prose_text(child)).join('')
    return BLOCK_NODES.has(node.type ?? '') ? `${inner} ` : inner
}


// Plain text of a document, with runs of whitespace collapsed — for deriving a label from the
// opening words of a custom page that the user hasn't named
export function prose_to_text(doc:PmDoc|undefined):string {
    if (!doc) {
        return ''
    }
    return collect_prose_text(doc).replace(/\s+/g, ' ').trim()
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
