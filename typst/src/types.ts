
import type {PmDoc} from 'pm-to-typst'


// Top-level request for generating a Typst document / PDF
export interface TypstRequest {
    title:string
    page:PageConfig
    typography:TypographyConfig
    titlepage:TitlepageConfig
    features:FeatureConfig
    content:TypstContentItem[]
    arrangement:'normal'|'book'|'booklet'
    show_pages:boolean
    booklet_portrait:boolean
    // How a passage image sits on the page: 'borderless' bleeds to the true page edge, 'padded'
    // stays within the normal page margins (see Blueprint.image_style)
    image_style:'borderless'|'padded'
    // Binary assets referenced by generated Typst source (virtual filename -> bytes), served via
    // the compiler's shadow filesystem — currently only passage images (see TypstPassageImage)
    assets:Record<string, Uint8Array>
    // Preview-only notice pages placed before/after the arranged document ("Start of preview"
    // when content before the window was cut, "End of preview" when content after was), kept
    // out of content so booklet imposition doesn't fold them into the sheet pairing — the
    // pipeline places them around the arranged pages instead (see truncate_for_preview)
    preview_front?:TypstCustomPage
    preview_rear?:TypstCustomPage
}


// Document-wide display options for the chapter (#ch), verse (#vn) and words-of-Jesus (#wj)
// markers. These drive global function definitions in the preamble rather than per-passage.
export interface FeatureConfig {
    show_chapters:boolean
    show_chapters_style:'divider'|'float'|'heading'
    show_verses:boolean
    show_wj:boolean
    show_wj_color:string|null
    show_wj_bold:boolean
    show_wj_italic:boolean
}


// Page dimensions and margins
export interface PageConfig {
    // Typst-native unit strings, e.g. "210mm", "8.5in"
    width:string
    height:string
    margin_top:string
    margin_bottom:string
    margin_left:string
    margin_right:string
}


// Font and paragraph settings
export interface TypographyConfig {
    font_text:string
    // Font for the second translation, when 2 bibles are selected (defaults to font_text)
    font_text2:string
    font_headings:string    // Font for chapter headings (show_chapters_style === 'heading')
    // Heading font within the second translation's content — font_headings if the user chose
    // one explicitly (headings stay consistent across both translations), else font_text2
    font_headings2:string
    font_fallbacks:string[]
    font_size:string        // e.g. "10pt"
    line_height:number      // e.g. 1.75 — module converts to Typst leading
    justify:boolean|null    // null = auto (justify when width permits)
    text_color:string|null  // Hex color for all text; unset = no fill rule (Typst default)
}


// Global styling for every title page in the document (standalone title items and passages
// auto-inserted via Blueprint.passage_title === 'titlepage' alike)
export interface TitlepageConfig {
    font:string                 // Resolved (blue.titlepage_font ?? blue.font_text)
    frame_svg:string|null       // Resolved corner-pattern SVG (raw, "#000000" placeholder), or null
    color_text:string           // Hex color for title/subtitle text
    color_frame:string          // Hex color for the corner pattern
    icon_size:number            // Size multiplier for the icon (1 = default)
    // Force every title page to start on this side (null = no forcing)
    always:'left'|'right'|null
}


// Union of all content item types
export type TypstContentItem = TypstPassage | TypstTitlePage | TypstCustomPage | TypstLinesPage


// A passage image, resolved to actual bytes + a virtual filename the compiler's shadow
// filesystem can serve it under (raster bytes can't be inlined as Typst source text like the
// SVG icons/frames in content_title.ts — see TypstRequest.assets)
export interface TypstPassageImage {
    filename:string
    bytes:Uint8Array
}


// Bible passage with all display configuration
export interface TypstPassage {
    type:'passage'
    // Pre-rendered Typst content per translation (1 or 2 bibles)
    bibles:BiblePassageData[]
    // Optional image shown in the top half of the passage's first page, before any
    // headings/content (null = none)
    image:TypstPassageImage|null
    // How multiple translations are laid out (single bible ignores this): 'columns' puts them
    // side by side on each page, 'alternate' as facing pages (compiled double-width and split
    // in post-processing — see process_facing in pdf_postprocess.ts)
    multi_layout:'columns'|'alternate'
    // Granularity at which the two translations are kept vertically aligned — the primary
    // translation's boundaries drive both sides (see bilingual.ts)
    multi_align:'verse'|'paragraph'|'chapter'
    // Which side gets blank/lines pages (null = no half-blank)
    half_blank:'left'|'right'|null
    // Per-passage content display toggles (chapter/verse/wj markers are document-wide,
    // see FeatureConfig on TypstRequest)
    show_headings:boolean
    // Subheading styling (applies when show_headings is on)
    headings_bold:boolean
    headings_italic:boolean
    headings_size:number    // Multiplier relative to text size (1 = same as text)
    show_footnotes:boolean
    // Dotted lines on blank half-pages
    show_lines:boolean
    // Column layout: 'auto' uses book code to decide, 1 or 2 forces column count
    columns:'auto'|1|2
    column_gap:string       // e.g. "5mm"
    // Book code for auto-column detection (e.g. "psa", "isa")
    book:string
    // Optional passage title displayed above content ('heading' mode only — 'titlepage' mode is
    // a separate synthetic TypstTitlePage item injected before this one, see bible_content.ts)
    passage_title:string|null
    passage_subtitle:string|null
    // Passage reference for progress reporting only (always set, regardless of passage_title)
    progress_label:string
}


// Pre-rendered Typst markup for one translation's passage
export interface BiblePassageData {
    content:string
}


// Decorative title page. Styling (frame/colors/font/icon size/page-side forcing) is document-wide
// — see TitlepageConfig on TypstRequest — so this only carries the page's own text/icon content
export interface TypstTitlePage {
    type:'title'
    title:string
    subtitle:string
    icon:string|null            // Resolved + recolored icon SVG (from an Iconify ID or raw SVG)
}


// Custom content page (copyright, notes, etc.)
export interface TypstCustomPage {
    type:'custom'
    content:string              // Typst markup generated by the app
    position:'top'|'middle'|'bottom'
}


// Page of dotted lines for notetaking
export interface TypstLinesPage {
    type:'lines'
    spacing:string              // e.g. "10mm"
}


// Function signature for compiling a Typst source string to PDF bytes. assets maps a virtual
// filename to bytes the compiler should serve it as (e.g. passage images) — raster bytes can't
// be inlined as Typst source text, so they're registered in the compiler's shadow filesystem
// instead and referenced by name from generated source (see TypstRequest.assets)
export type CompileFn =
    (source:string, assets?:Record<string, Uint8Array>) => Promise<Uint8Array>


// Coarse stages reported during PDF generation. 'fetch' and 'compile' are the only stages that
// carry i/total (one event per book downloaded / content group rendered); 'start', 'arrange' and
// 'finalize' are single one-off events. Consumers are free to only surface a subset of these to
// the user and silently ignore the rest (e.g. 'arrange' is a mid-pipeline bookkeeping step most
// UIs will fold into a generic "final touches" message rather than showing on its own)
export type ProgressStage = 'start' | 'fetch' | 'compile' | 'arrange' | 'finalize'

// One coarse progress update; i/total/label are only populated where meaningful for the stage
export interface ProgressEvent {
    stage:ProgressStage
    i?:number
    total?:number
    label?:string
}

// Callback for coarse progress reporting (fetching/rendering steps)
export type ProgressFn = (event:ProgressEvent) => void


// --- Blueprint input model ---------------------------------------------------------------
// The user-facing options structure selected in the app. BibleContent.resolve() turns a
// Blueprint into a (fully resolved) TypstRequest, so the same options can drive both the
// in-browser and server (Node) pipelines.


// Optional book cover, created via the embedded cover.paper.bible editor. `form` is the
// widget's pure-JSON EmbedFormState (kept opaque so this package gains no bookcover
// dependency) — the renderable schema is derived from it at render time via bookcover's
// build_schema. Binaries (bg image bytes, font bytes) live in Cloud Storage / the user's
// font library, never here
export interface CoverConfig {
    // Widget form snapshot (EmbedFormState, no binaries inside) — restores the editor and
    // feeds build_schema; its size fields are overridden from the blueprint's own printing
    // fields at render time (see cover_form_for_render)
    form:Record<string, unknown>
    // Storage path of the uploaded background image bytes, null when none
    bg_image_path:string|null
    // SHA-256 hex of the bg image bytes — render cache key + upload dedup
    bg_image_hash:string|null
    // Custom font families the cover references (resolved from the user's font library)
    font_families:string[]
}


// A complete set of user-selected options for generating a document
export interface Blueprint {

    // Title used in PDF meta and download file name
    title:string

    // Optional book cover (null = no cover)
    cover:CoverConfig|null

    // Printing
    service_id:string  // printing service id, or 'custom' for manual bleed/spine
    size_id:string  // named size id, or '' for custom dimensions
    binding_type:string
    ink_type:string
    paper_type:string
    custom_unit:'mm'|'inch'
    custom_trim_width:number
    custom_trim_height:number
    custom_bleed:number
    custom_spine:number
    booklet:boolean
    booklet_portrait:boolean

    // Content
    content:ContentItem[]
    bibles:[string, ...string[]]
    bibles_layout:'alternate'|'columns'
    bibles_align:'verse'|'paragraph'|'chapter'

    // Features
    show_headings:boolean
    show_headings_bold:boolean
    show_headings_italic:boolean
    show_headings_size:number  // Multiplier relative to text size (1 = same as text)
    show_chapters:boolean
    show_chapters_style:'divider'|'float'|'heading'
    show_verses:boolean
    show_pages:boolean
    show_footnotes:boolean
    show_wj:boolean
    show_wj_color:string|null
    show_wj_bold:boolean
    show_wj_italic:boolean
    show_lines:boolean
    notes:string|null
    crossref:'small'|'medium'|'large'|null
    half_blank:'left'|'right'|null
    // How passages with a title show it: null = never (even if title text is set), 'titlepage' =
    // insert a decorative title page (styled per the Title pages section below) before the
    // passage, 'heading' = inline heading + subheading (no icon) at the start of its own content
    passage_title:'titlepage'|'heading'|null

    // Style
    font_text:string
    font_text2:string|null     // null = auto (matches font_text); font for the 2nd translation
    font_headings:string|null  // null = auto (matches font_text)
    font_size:number
    line_height:number
    justify:null|boolean
    text_color:string|null
    columns:null|boolean

    // Title pages (global — applies uniformly to every title page in the document: standalone
    // title items and passage-auto-inserted title pages alike)
    titlepage_frame:string|null        // Pattern name (key into PATTERNS); null = no corner frame
    titlepage_color_text:string|null   // null = default black
    titlepage_color_icon:string|null   // null = default black
    titlepage_color_frame:string|null  // null = default black
    titlepage_font:string|null         // null = auto (matches font_text)
    titlepage_icon_size:number         // Size multiplier for the icon (1 = default)
    // Force every title page to start on this side; null = no forcing
    titlepage_always:'left'|'right'|null

    // Images (global — applies to every passage image; per-passage content is on ContentPassage)
    image_style:'borderless'|'padded'

    // Spacing
    margin_unit:'mm'|'in'
    margin_top:number
    margin_bottom:number
    margin_inner:number
    margin_outer:number
    column_gap:number

    // Legal
    public_domain:boolean
    app_link:boolean
}


// A single item in the document's content list
export type ContentItem = ContentTitle|ContentPassage|ContentCustom


// Decorative title page item. Styling is document-wide (see Blueprint's titlepage_* fields) —
// this only carries the page's own text/icon content
export interface ContentTitle {
    type:'title'
    id:string
    title:string
    title_subtitle:string
    title_icon:string|null
}


// Bible passage reference item (resolved to fetched content at render time). title/title_subtitle/
// title_icon mirror ContentTitle's fields — set when the passage should auto-show a title (as a
// title page or inline heading, per Blueprint.passage_title)
export interface ContentPassage {
    type:'passage'
    id:string
    book:string
    start_chapter:number|null
    start_verse:number|null
    end_chapter:number|null
    end_verse:number|null
    title:string
    title_subtitle:string
    title_icon:string|null
    image:ContentPassageImage|null
}


// An image shown in the top half of a passage's first page, before any headings/content. Either
// a URL to an external image service, or a user-uploaded image (content-addressed in Storage,
// mirroring CoverConfig's bg image). `url` is always the fetchable address the shared typst core
// package fetches via plain fetch() — for 'upload' it's the uploaded file's own download URL, so
// core never needs to know about Storage/Firebase at all. `path`/`hash` are app-layer bookkeeping
// only (upload dedup + version-freeze re-pathing), unused by core.
export interface ContentPassageImage {
    source:'url'|'upload'
    url:string|null
    path:string|null
    hash:string|null
}


// Custom rich-text page item (ProseMirror/Tiptap doc, converted to Typst at render time)
export interface ContentCustom {
    type:'custom'
    id:string
    name:string
    doc:PmDoc
    position:'top'|'middle'|'bottom'
}


// --- Study notes -------------------------------------------------------------------------
// Fetched notes data for one book, already pre-rendered as Typst markup by the content API


// A note that spans a verse range, inserted at its start verse
export interface TypstNoteRange {
    start_chapter:number
    start_verse:number
    end_chapter:number
    end_verse:number
    contents:string  // pre-rendered Typst markup
}


// A book's full set of study notes: single-verse notes plus verse-range notes
export interface TypstNotesFile {
    notes_id:string
    book:string
    verses:Record<string, Record<string, string>>  // chapter -> verse -> Typst markup
    ranges:TypstNoteRange[]
}
