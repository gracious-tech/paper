
// Public API for paper-bible-typst

// Inner function: generates a single compilable Typst document string
export {generate_typst} from './generate.js'

// Full pipeline: generates, compiles (via provided function), and post-processes to PDF
export {generate_pdf} from './pdf_postprocess.js'

// Preview pipeline: lays out the printed pages as facing-page book spreads (preview only)
export {generate_pdf_spread_preview} from './pdf_postprocess.js'

// Bundled font manifest + helpers (used by the web/node compilers to load fonts)
export {FONTS_DIR, BUNDLED_FONTS, BASE_FONT, get_bundled_font, asset_path, collect_fonts,
    } from './fonts.js'
export type {BundledFont} from './fonts.js'

// Bible-content resolver: turns a user Blueprint into a resolved TypstRequest (fetches/caches)
export {BibleContent} from './bible_content.js'
export type {BibleContentOptions} from './bible_content.js'

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
    Blueprint,
    ContentItem,
    ContentTitle,
    ContentPassage,
    ContentCustom,
} from './types.js'
