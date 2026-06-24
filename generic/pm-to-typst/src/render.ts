
// Format-agnostic walker that turns a ProseMirror document into a string via a Renderer

import type {PmNode, PmDoc, Renderer, RenderContext} from './types.js'

// Apply a text node's marks (inner-out) over its rendered content
function render_text(node:PmNode, renderer:Renderer):string {
    let out = renderer.text(node)
    for (const mark of node.marks ?? []) {
        const handler = renderer.marks[mark.type]
        if (handler)
            out = handler(mark, out)
    }
    return out
}

// Default handling for unknown node types — just render their children
function default_fallback(_node:PmNode, ctx:RenderContext):string {
    return ctx.children()
}

// Build the recursion context handed to each node handler
function make_context(node:PmNode, renderer:Renderer):RenderContext {
    return {
        children: (separator = '') =>
            (node.content ?? []).map(child => render_node(child, renderer)).join(separator),
        node: (n:PmNode) => render_node(n, renderer),
    }
}

// Render a single node by dispatching to the renderer's text / node / fallback handler
function render_node(node:PmNode, renderer:Renderer):string {
    // Text nodes apply their marks over the rendered string content
    if (node.type === 'text')
        return render_text(node, renderer)
    // Look up the handler for this node type, falling back to children-only rendering
    const handler = renderer.nodes[node.type ?? ''] ?? renderer.fallback ?? default_fallback
    return handler(node, make_context(node, renderer))
}

/** Render a full ProseMirror document to a string with the given renderer */
export function render(doc:PmDoc, renderer:Renderer):string {
    return render_node(doc, renderer)
}

/** Merge custom node/mark handlers over a base renderer (used to extend a format) */
export function extend_renderer(base:Renderer, custom?:Partial<Renderer>):Renderer {
    if (!custom)
        return base
    return {
        text: custom.text ?? base.text,
        nodes: {...base.nodes, ...custom.nodes},
        marks: {...base.marks, ...custom.marks},
        fallback: custom.fallback ?? base.fallback,
    }
}
