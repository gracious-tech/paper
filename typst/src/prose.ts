
// Convert a custom-page ProseMirror/Tiptap document to Typst markup, extending the generic
// pm-to-typst renderer with the marks/nodes the app's editor uses but the base lacks
// (subscript, superscript, and paragraph/heading text alignment).

import {pm_to_typst} from 'pm-to-typst'

import type {PmDoc, PmNode, Renderer, RenderContext} from 'pm-to-typst'


// Marker users can place in custom content to auto-insert the generated copyright statement
export const COPYRIGHT_MARKER = 'AUTO-COPYRIGHT'


// Map a ProseMirror textAlign attr to the Typst alignment keyword (justify uses left + the
// document-level justify setting handles actual justification)
const ALIGN_MAP:Record<string, string> = {center: 'center', right: 'right', justify: 'left'}


// Wrap block content in a Typst alignment call when a non-default alignment is set
function align_typst(content:string, node:PmNode):string {
    const align = node.attrs?.['textAlign'] as string|undefined
    if (!align || align === 'left') {
        return content
    }
    return `#align(${ALIGN_MAP[align] ?? 'left'})[${content}]`
}


// Extra node/mark handlers layered over pm-to-typst's base Typst renderer
const EXTENSIONS:Partial<Renderer> = {

    nodes: {

        // Paragraph and heading gain text-alignment support
        paragraph: (node:PmNode, ctx:RenderContext) => align_typst(ctx.children(), node),
        heading: (node:PmNode, ctx:RenderContext) => {
            const level = Number(node.attrs?.['level'] ?? 1)
            return align_typst('='.repeat(level) + ' ' + ctx.children(), node)
        },
    },

    marks: {

        // Subscript and superscript map onto Typst's sub/super functions
        subscript: (_mark, inner:string) => `#sub[${inner}]`,
        superscript: (_mark, inner:string) => `#super[${inner}]`,
    },
}


// Convert a full custom-page document to Typst markup
export function prose_to_typst(doc:PmDoc|undefined):string {
    if (!doc) {
        return ''
    }
    return pm_to_typst(doc, EXTENSIONS)
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
