
// Public API: a renderer that walks the ProseMirror document model (Tiptap's getJSON()) to
// Typst markup. The renderer is an extensible registry (extend_renderer) so a richer project
// can add node/mark handlers without forking the core.

export {pm_to_typst, typst_renderer} from './typst.js'
export {render, extend_renderer} from './render.js'
export type {
    PmDoc, PmNode, PmMark, Renderer, NodeHandler, MarkHandler, RenderContext,
} from './types.js'
