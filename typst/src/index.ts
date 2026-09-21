
// Public API for paper-bible-typst

// Inner function: generates a single compilable Typst document string
export {generate_typst} from './generate.js'

// Full pipeline: generates, compiles (via provided function), and post-processes to PDF
export {generate_pdf} from './pdf_postprocess.js'

// Preview pipeline: lays out the printed pages as facing-page book spreads (preview only)
export {generate_pdf_spread_preview} from './pdf_postprocess.js'

// Adds a short "this is only a preview" / "end of preview" strip to the front/back of a preview PDF
export {add_preview_strip} from './pdf_postprocess.js'

// Preview truncation: cuts an over-long request down to a fast-compiling window of content
export {truncate_for_preview, PREVIEW_CHAR_LIMIT} from './preview.js'
export type {PreviewSection, PreviewTruncation} from './preview.js'

// Bundled font manifest helpers (used by the web/node compilers to load fonts). The manifest
// itself is loaded at runtime by typst-fonts/node or typst-fonts/web from the assets tree
export {get_bundled_font, collect_fonts} from './fonts.js'
export type {BundledFont} from './fonts.js'

// Bible-content resolver: turns a user Blueprint into a resolved TypstRequest (fetches/caches)
export {BibleContent} from './bible_content.js'
export type {BibleContentOptions} from './bible_content.js'

// Storage paths for a design's uploaded assets (shared so client and server never diverge)
export {design_assets_prefix, version_assets_prefix, design_cache_prefix, asset_basename,
    to_version_asset, to_design_asset, DESIGN_ASSETS, VERSION_ASSETS, DESIGN_CACHE}
    from './asset_paths.js'
export type {StoredFontMeta} from './asset_paths.js'

// Blueprint <-> Firestore doc-shape splitting (shared so client and server never diverge)
export {split_blueprint_doc, join_blueprint_doc, resolve_design_name, get_cover_title,
    get_cover_title_from_form, COVER_TITLE_KEY} from './blueprint_doc.js'
export type {BlueprintDocFields} from './blueprint_doc.js'

// Constants shared between the app and the server
export {SCHEMA_VERSION, PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS,
    QUOTA_LIFETIME_MS} from './consts.js'

// Forward migration of stored blueprints written under an older SCHEMA_VERSION. Designs are
// migrated on read and persist the upgrade on their next save; versions are migrated per-read
// into a clone and never rewritten (see migrate.ts)
export {migrate_blueprint_doc, migrate_version_blueprint, migration_steps,
    MIGRATIONS} from './migrate.js'
export type {BlueprintMigration} from './migrate.js'

// Blueprint shape validation (schema factory — callers supply the defaults to fall back to)
export {make_blueprint_schema, clean_content_items, cover_config_schema} from './blueprint_schema.js'

// Cover render helpers (blueprint size overlay + render cache key) and the shape check that
// bounds any builtin background reference
export {cover_form_for_render, cover_render_key, is_builtin_background} from './cover.js'

// Trim-size resolution (service + named size, or custom dimensions) and a mm/in converter —
// used for the interior margin clamp and, in the app, the cover's create-time back-margin seed
export {resolve_trim, resolve_reading_trim, convert_unit, typst_unit, resolve_binding_gutter}
    from './trim.js'

// Bundled title-page decorative pattern SVGs (name → corner SVG), used by the resolver and the
// app's title-page editor
export {PATTERNS} from './generated/patterns.js'

// Whether a passage image's url is one a server-side compile may fetch — the content list is
// client-written, so the compile service checks every url before accepting a version
export {is_fetchable_image_url, MAX_IMAGE_BYTES} from './image_cache.js'

// Custom-page prose helpers (ProseMirror → Typst + the auto-copyright marker)
export {prose_to_typst, prose_to_text, doc_has_copyright, replace_copyright_marker,
    COPYRIGHT_MARKER} from './prose.js'
export type {PmDoc} from 'pm-to-typst'

// Copyright/attribution statement builder — shared by the interior compile (bible_content) and
// the cover blurb (the default cover seeds the AUTO-COPYRIGHT marker into its rear text)
export {gen_copyright_typst} from './copyright.js'

// All types
export type {
    TypstRequest,
    PageConfig,
    TypographyConfig,
    TitlepageConfig,
    FeatureConfig,
    TypstContentItem,
    TypstPassage,
    TypstPassageImage,
    BiblePassageData,
    TypstTitlePage,
    TypstCustomPage,
    TypstLinesPage,
    TypstPictureStory,
    TypstPictureStorySlide,
    CompileFn,
    ProgressFn,
    ProgressStage,
    ProgressEvent,
    Blueprint,
    CoverConfig,
    CoverBgImage,
    ContentItem,
    ContentTitle,
    ContentPassage,
    ContentPassageImage,
    ContentImageRef,
    ContentCustom,
    ContentPictureStory,
    PictureStorySlide,
    ImageStyle,
    MeasureUnit,
} from './types.js'
