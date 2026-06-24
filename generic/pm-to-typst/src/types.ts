
// Type definitions for ProseMirror / Tiptap document JSON and the render registry

/** A formatting mark applied to a text node (bold, italic, link, etc.) */
export interface PmMark {
    type:string
    attrs?:Record<string, unknown>
}

/** A ProseMirror document node — the canonical model emitted by Tiptap's getJSON() */
export interface PmNode {
    type?:string
    content?:PmNode[]
    text?:string
    marks?:PmMark[]
    attrs?:Record<string, unknown>
}

/** A full document is just the root node (type 'doc') */
export type PmDoc = PmNode

/** Context handed to every node handler, providing recursion back into the walker */
export interface RenderContext {
    // Render this node's children, joined by the given separator (default '')
    children:(separator?:string) => string
    // Render an arbitrary node (used by handlers that recurse manually)
    node:(node:PmNode) => string
}

/** Renders a single block/inline node to a string */
export type NodeHandler = (node:PmNode, ctx:RenderContext) => string

/** Wraps already-rendered inner text with a mark's formatting */
export type MarkHandler = (mark:PmMark, inner:string) => string

/** A complete output format: how to render text, each node type, and each mark type */
export interface Renderer {
    // Render a raw text node's string content (escaping happens here)
    text:(node:PmNode) => string
    // Handlers keyed by node type name (camelCase, as Tiptap emits)
    nodes:Record<string, NodeHandler>
    // Handlers keyed by mark type name (marks with no handler render as plain inner text)
    marks:Record<string, MarkHandler>
    // Fallback for unknown node types — defaults to rendering children
    fallback?:NodeHandler
}
