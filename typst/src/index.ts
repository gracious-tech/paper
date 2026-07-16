
// Public API for paper-bible-typst

// Inner function: generates a single compilable Typst document string
export {generate_typst} from './generate.js'

// Full pipeline: generates, compiles (via provided function), and post-processes to PDF
export {generate_pdf} from './pdf_postprocess.js'

// Preview pipeline: lays out the printed pages as facing-page book spreads (preview only)
export {generate_pdf_spread_preview} from './pdf_postprocess.js'

// Preview truncation: cuts an over-long request down to a fast-compiling window of content
export {truncate_for_preview, PREVIEW_CHAR_LIMIT} from './preview.js'
export type {PreviewSection, PreviewMessages, PreviewTruncation} from './preview.js'

// Bundled font manifest helpers (used by the web/node compilers to load fonts). The manifest
// itself is loaded at runtime by typst-fonts/node or typst-fonts/web — see .bin/download_fonts
export {get_bundled_font, collect_fonts} from './fonts.js'
export type {BundledFont} from './fonts.js'

// Bible-content resolver: turns a user Blueprint into a resolved TypstRequest (fetches/caches)
export {BibleContent} from './bible_content.js'
export type {BibleContentOptions} from './bible_content.js'

// Blueprint <-> Firestore doc-shape splitting (shared so client and server never diverge)
export {split_blueprint_doc, join_blueprint_doc} from './blueprint_doc.js'
export type {BlueprintDocFields} from './blueprint_doc.js'

// Constants shared between the app and the server
export {SCHEMA_VERSION, PDF_LIFETIME_MS} from './consts.js'

// Blueprint shape validation (schema factory — callers supply the defaults to fall back to)
export {make_blueprint_schema, clean_content_items} from './blueprint_schema.js'

// Bundled title-page decorative pattern SVGs (name → corner SVG), used by the resolver and the
// app's title-page editor
export {PATTERNS} from './generated/patterns.js'

// Custom-page prose helpers (ProseMirror → Typst + the auto-copyright marker)
export {prose_to_typst, doc_has_copyright, COPYRIGHT_MARKER} from './prose.js'
export type {PmDoc} from 'pm-to-typst'

// All types
export type {
    TypstRequest,
    PageConfig,
    TypographyConfig,
    FeatureConfig,
    TypstContentItem,
    TypstPassage,
    BiblePassageData,
    TypstTitlePage,
    TypstCustomPage,
    TypstLinesPage,
    CompileFn,
    ProgressFn,
    ProgressStage,
    ProgressEvent,
    Blueprint,
    ContentItem,
    ContentTitle,
    ContentPassage,
    ContentCustom,
} from './types.js'
