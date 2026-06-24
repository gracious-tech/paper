
// Typst renderer — maps the Tiptap StarterKit node/mark vocabulary onto Typst markup

import type {PmNode, PmDoc, Renderer, RenderContext} from './types.js'
import {escape_typst, escape_typst_str} from 'typst-utils'
import {render, extend_renderer} from './render.js'

// Collect the raw (unescaped) text of a node and its descendants
function collect_text(node:PmNode):string {
    if (node.type === 'text')
        return node.text ?? ''
    return (node.content ?? []).map(collect_text).join('')
}

// Render a list node: one item per line, with wrapped/nested lines indented under the marker
function render_list(node:PmNode, ctx:RenderContext, marker:string):string {
    const items = (node.content ?? []).map(item => {
        // Each list item's block children are rendered and joined with a blank line
        const inner = (item.content ?? []).map(ctx.node).join('\n\n')
        // Indent continuation lines so they align under the marker
        return marker + inner.replace(/\n/g, '\n' + ' '.repeat(marker.length))
    })
    return items.join('\n')
}

/** The default ProseMirror -> Typst renderer (extend it via pm_to_typst's second argument) */
export const typst_renderer:Renderer = {

    // Inline code renders as Typst raw; everything else is escaped literal text
    text: node => {
        if ((node.marks ?? []).some(mark => mark.type === 'code'))
            return `#raw("${escape_typst_str(node.text ?? '')}")`
        return escape_typst(node.text ?? '')
    },

    nodes: {

        // Root: block children separated by a blank line
        doc: (_node, ctx) => ctx.children('\n\n'),

        // Paragraph: just its inline content
        paragraph: (_node, ctx) => ctx.children(),

        // Heading: level 1 -> "=", level 2 -> "==", etc.
        heading: (node, ctx) => {
            const level = Number(node.attrs?.level ?? 1)
            return '='.repeat(level) + ' ' + ctx.children()
        },

        // Bullet and ordered lists use Typst's "- " and "+ " markers
        bulletList: (node, ctx) => render_list(node, ctx, '- '),
        orderedList: (node, ctx) => render_list(node, ctx, '+ '),
        listItem: (_node, ctx) => ctx.children('\n\n'),

        // Blockquote wraps its blocks in a Typst quote block
        blockquote: (_node, ctx) => `#quote[${ctx.children('\n\n')}]`,

        // Thematic break
        horizontalRule: () => '#line(length: 100%)',

        // Inline hard line break
        hardBreak: () => '\\\n',

        // Fenced code block renders as a Typst raw block (content taken unescaped)
        codeBlock: node => `#raw(block: true, "${escape_typst_str(collect_text(node))}")`,
    },

    // Emphasis marks map onto Typst markup; 'code' is handled in text(), and 'link' is
    // intentionally omitted so links collapse to their plain (escaped) text content
    marks: {
        bold: (_mark, inner) => `*${inner}*`,
        italic: (_mark, inner) => `_${inner}_`,
        strike: (_mark, inner) => `#strike[${inner}]`,
        underline: (_mark, inner) => `#underline[${inner}]`,
    },
}

/** Convert a ProseMirror document to Typst markup, optionally extending the base renderer */
export function pm_to_typst(doc:PmDoc, custom?:Partial<Renderer>):string {
    const out = render(doc, extend_renderer(typst_renderer, custom))
    // Collapse runs of blank lines and trim surrounding whitespace
    return out.replace(/\n{3,}/g, '\n\n').trim()
}
