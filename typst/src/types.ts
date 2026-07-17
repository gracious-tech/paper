
import type {PmDoc} from 'pm-to-typst'


// Top-level request for generating a Typst document / PDF
export interface TypstRequest {
    title:string
    page:PageConfig
    typography:TypographyConfig
    features:FeatureConfig
    content:TypstContentItem[]
    arrangement:'normal'|'book'|'booklet'
    show_pages:boolean
    booklet_portrait:boolean
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
    font_titles:string      // Font for title-page title/subtitle text
    font_fallbacks:string[]
    font_size:string        // e.g. "10pt"
    line_height:number      // e.g. 1.75 — module converts to Typst leading
    justify:boolean|null    // null = auto (justify when width permits)
    text_color:string|null  // Hex color for all text; unset = no fill rule (Typst default)
}


// Union of all content item types
export type TypstContentItem = TypstPassage | TypstTitlePage | TypstCustomPage | TypstLinesPage


// Bible passage with all display configuration
export interface TypstPassage {
    type:'passage'
    // Pre-rendered Typst content per translation (1 or 2 bibles)
    bibles:BiblePassageData[]
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
    // Optional passage reference displayed above content
    passage_title:string|null
    // Passage reference for progress reporting only (always set, regardless of passage_title)
    progress_label:string
    // Ensure this starts on its own sheet with blank rear
    alone:boolean
}


// Pre-rendered Typst markup for one translation's passage
export interface BiblePassageData {
    content:string
}


// Decorative title page
export interface TypstTitlePage {
    type:'title'
    title:string
    subtitle:string
    icon:string|null            // Resolved + recolored icon SVG (from an Iconify ID or raw SVG)
    icon_size:number            // Size multiplier for the icon (1 = default)
    // One corner SVG string — module mirrors to all 4 corners
    pattern_svg:string|null
    color_primary:string        // Hex color for text
    color_secondary:string      // Hex color for pattern and icon
    // Ensure this starts on its own sheet with blank rear
    alone:boolean
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


// Function signature for compiling a Typst source string to PDF bytes
export type CompileFn = (source:string) => Promise<Uint8Array>


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
    page_count:number
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

    // Style
    font_text:string
    font_text2:string|null     // null = auto (matches font_text); font for the 2nd translation
    font_headings:string|null  // null = auto (matches font_text)
    font_titles:string|null    // null = auto (matches font_text)
    font_size:number
    line_height:number
    justify:null|boolean
    text_color:string|null
    columns:null|boolean

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


// Decorative title page item
export interface ContentTitle {
    type:'title'
    id:string
    title:string
    subtitle:string
    icon:string|null
    icon_size:number  // Size multiplier for the icon (1 = default)
    pattern:string
    color_primary:string|null
    color_secondary:string|null
    alone:boolean  // Ensure appears on own page with blank rear (and also not on rear of previous)
}


// Bible passage reference item (resolved to fetched content at render time)
export interface ContentPassage {
    type:'passage'
    id:string
    book:string
    start_chapter:number|null
    start_verse:number|null
    end_chapter:number|null
    end_verse:number|null
    title:boolean
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
