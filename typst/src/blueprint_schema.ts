
import {z} from 'zod'

import type {PmDoc} from 'pm-to-typst'
import {is_builtin_background} from './cover.js'

import type {Blueprint, ContentImageRef, ContentItem, ContentPassageImage, CoverConfig,
    PictureStorySlide} from './types.js'


// Zod validation for untrusted Blueprint data (Firestore docs written by co-editors). The TS
// interfaces in types.ts stay the source of truth — every schema below is type-locked against
// them with `satisfies z.ZodType<...>` so any drift becomes a compile error.
// Semantics: invalid/missing scalar fields fall back to a caller-supplied default per field;
// invalid content items are dropped entirely (there is no sensible per-field default for an
// item the user never created)


// ProseMirror docs are only validated shallowly — unknown/malformed nodes are the concern of
// prose_to_typst at render time, and a bad doc can only break its author's own compile
const pm_doc_schema = z.custom<PmDoc>(value => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
})


// Decorative title page item. Per-field .catch() rather than the wholesale item-drop a bad
// field would otherwise trigger (see clean_content_items below): the subtitle and icon are
// decoration, so an item that lost one still loads with a sensible blank rather than
// disappearing from its author's own content list
const content_title_schema = z.object({
    type: z.literal('title'),
    id: z.string().min(1),
    title: z.string().catch(''),
    title_subtitle: z.string().catch(''),
    title_icon: z.string().nullable().catch(null),
}) satisfies z.ZodType<ContentItem>


// A passage image (URL or user-uploaded, see ContentPassageImage) — per-field .catch() so a
// malformed image config degrades to "no image" rather than dropping the whole passage
const content_image_ref_schema = z.object({
    source: z.enum(['url', 'upload']).catch('url'),
    url: z.string().nullable().catch(null),
    path: z.string().nullable().catch(null),
    hash: z.string().nullable().catch(null),
}) satisfies z.ZodType<ContentImageRef>
const content_passage_image_schema = content_image_ref_schema.extend({
    // A bad unmasked source costs the image its "undo the mask" path, not the image itself —
    // dropping it here just means a duplicate/restore keeps the masked copy
    original: content_image_ref_schema.nullable().catch(null),
}) satisfies z.ZodType<ContentPassageImage>


// Bible passage reference item. title/title_subtitle/title_icon use per-field .catch() for the
// same reason as content_title_schema above, but the stakes are higher here: the heading is
// decoration around a reference, so a type mismatch on any one of those fields must not drop
// the whole passage (book/chapters/verses included) from its author's content list. title
// falls back to null (auto-generate a heading from the reference) rather than '' (explicitly
// no heading at all), since a passage silently losing its heading is the harder loss to spot
const content_passage_schema = z.object({
    type: z.literal('passage'),
    id: z.string().min(1),
    book: z.string().min(1),
    start_chapter: z.number().nullable(),
    start_verse: z.number().nullable(),
    end_chapter: z.number().nullable(),
    end_verse: z.number().nullable(),
    title: z.string().nullable().catch(null),
    title_subtitle: z.string().catch(''),
    title_icon: z.string().nullable().catch(null),
    image: content_passage_image_schema.nullable().catch(null),
}) satisfies z.ZodType<ContentItem>


// Custom rich-text page item
const content_custom_schema = z.object({
    type: z.literal('custom'),
    id: z.string().min(1),
    name: z.string(),
    doc: pm_doc_schema,
    position: z.enum(['top', 'middle', 'bottom']),
}) satisfies z.ZodType<ContentItem>


// One slide of a picture story. Per-field .catch() everywhere (except the required id) so a
// malformed slide degrades to sensible blanks rather than dropping the whole story — both the
// passage-ref fields and the text doc are always present regardless of the slide's current mode
const picture_story_slide_schema = z.object({
    id: z.string().min(1),
    image: content_passage_image_schema.nullable().catch(null),
    mode: z.enum(['passage', 'text']).catch('passage'),
    book: z.string().catch(''),
    start_chapter: z.number().nullable().catch(null),
    start_verse: z.number().nullable().catch(null),
    end_chapter: z.number().nullable().catch(null),
    end_verse: z.number().nullable().catch(null),
    doc: pm_doc_schema.catch({type: 'doc', content: []} as PmDoc),
}) satisfies z.ZodType<PictureStorySlide>


// A picture-story item (a sequence of illustrated slides). title uses per-field .catch() like
// the other items, falling back to null (auto) rather than '' (explicitly no heading) for the
// same reason as content_passage_schema above; a bad slides array degrades to empty rather than
// dropping the whole item
const content_picture_story_schema = z.object({
    type: z.literal('picture_story'),
    id: z.string().min(1),
    title: z.string().nullable().catch(null),
    title_subtitle: z.string().catch(''),
    title_icon: z.string().nullable().catch(null),
    slides: z.array(picture_story_slide_schema).catch([]),
}) satisfies z.ZodType<ContentItem>


// Cover config — the widget form is only validated shallowly; the cover renderer re-parses
// the derived schema with bookcover's own zod schema, so a bad co-editor value can only
// break its own cover render (never the book compile). bg_image.id is shape-checked here too
// (defense in depth alongside the server's own check in compile.ts, which is the actual
// security boundary — this schema only runs app-side)
const cover_bg_image_schema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('builtin'), id: z.string().refine(is_builtin_background)}),
    z.object({kind: z.literal('custom'), path: z.string(), hash: z.string()}),
])
export const cover_config_schema = z.object({
    form: z.record(z.string(), z.unknown()),
    // A bad image reference costs the cover its background, not the whole cover — dropping the
    // cover entirely would silently discard the user's title, blurb and styling along with it
    bg_image: cover_bg_image_schema.nullable().catch(null),
    font_families: z.array(z.string()),
    // Per-field .catch() so covers saved before the follow-the-name behaviour existed load as
    // "not hand-edited" rather than dropping the whole cover
    title_custom: z.boolean().catch(false),
}) satisfies z.ZodType<CoverConfig>


// Any single content item
const content_item_schema = z.discriminatedUnion('type',
    [content_title_schema, content_passage_schema, content_custom_schema,
        content_picture_story_schema])


export function clean_content_items(items:unknown[]):ContentItem[]{
    // Validate a content list, dropping invalid items and duplicate ids (duplicates would
    // collide in the Firestore content_items map — keep the first occurrence)
    const seen = new Set<string>()
    const cleaned:ContentItem[] = []
    for (const item of items){
        const result = content_item_schema.safeParse(item)
        if (result.success && !seen.has(result.data.id)){
            seen.add(result.data.id)
            cleaned.push(result.data)
        }
    }
    return cleaned
}


export function make_blueprint_schema(defaults:Blueprint):z.ZodType<Blueprint>{
    // Build a Blueprint schema that falls back to the given defaults per field (and wholesale
    // if the input isn't an object at all). Callers must pass a fresh defaults object — catch
    // values are referenced, not cloned, so a shared defaults object could leak mutations
    return z.object({

        name: z.string().catch(defaults.name),

        // Cover
        cover: cover_config_schema.nullable().catch(defaults.cover),

        // Printing
        service_id: z.string().catch(defaults.service_id),
        size_id: z.string().catch(defaults.size_id),
        binding_type: z.string().catch(defaults.binding_type),
        ink_type: z.string().catch(defaults.ink_type),
        paper_type: z.string().catch(defaults.paper_type),
        custom_unit: z.enum(['mm', 'inch']).catch(defaults.custom_unit),
        custom_trim_width: z.number().catch(defaults.custom_trim_width),
        custom_trim_height: z.number().catch(defaults.custom_trim_height),
        custom_bleed: z.number().catch(defaults.custom_bleed),
        custom_spine: z.number().catch(defaults.custom_spine),
        booklet: z.boolean().catch(defaults.booklet),
        booklet_portrait: z.boolean().catch(defaults.booklet_portrait),

        // Content (items validated individually — a bad item is dropped, a non-array falls
        // back to the default content wholesale)
        content: z.unknown().transform(value => {
            return Array.isArray(value) ? clean_content_items(value) : defaults.content
        }),
        last_item_at_end: z.boolean().catch(defaults.last_item_at_end),
        bibles: z.tuple([z.string()], z.string()).catch(() => defaults.bibles),
        bibles_layout: z.enum(['alternate', 'columns']).catch(defaults.bibles_layout),
        bibles_align: z.enum(['verse', 'paragraph', 'chapter']).catch(defaults.bibles_align),

        // Features
        show_headings: z.boolean().catch(defaults.show_headings),
        show_headings_bold: z.boolean().catch(defaults.show_headings_bold),
        show_headings_italic: z.boolean().catch(defaults.show_headings_italic),
        show_headings_size: z.number().catch(defaults.show_headings_size),
        show_chapters: z.boolean().catch(defaults.show_chapters),
        show_chapters_style: z.enum(['divider', 'float', 'heading'])
            .catch(defaults.show_chapters_style),
        show_verses: z.boolean().catch(defaults.show_verses),
        running_pages: z.boolean().catch(defaults.running_pages),
        running_headings: z.boolean().catch(defaults.running_headings),
        running_position: z.enum(['header', 'footer']).catch(defaults.running_position),
        running_align: z.enum(['center', 'outer']).catch(defaults.running_align),
        show_footnotes: z.boolean().catch(defaults.show_footnotes),
        show_wj: z.boolean().catch(defaults.show_wj),
        show_wj_color: z.string().nullable().catch(defaults.show_wj_color),
        show_wj_bold: z.boolean().catch(defaults.show_wj_bold),
        show_wj_italic: z.boolean().catch(defaults.show_wj_italic),
        show_lines: z.boolean().catch(defaults.show_lines),
        notes: z.string().nullable().catch(defaults.notes),
        half_blank: z.enum(['left', 'right']).nullable().catch(defaults.half_blank),
        passage_title: z.enum(['titlepage', 'heading']).nullable().catch(defaults.passage_title),

        // Style
        font_text: z.string().catch(defaults.font_text),
        font_text2: z.string().nullable().catch(defaults.font_text2),
        font_headings: z.string().nullable().catch(defaults.font_headings),
        font_size: z.number().catch(defaults.font_size),
        font_size2: z.number().catch(defaults.font_size2),
        line_height: z.number().catch(defaults.line_height),
        line_height2: z.number().catch(defaults.line_height2),
        justify: z.boolean().nullable().catch(defaults.justify),
        hyphenate: z.boolean().catch(defaults.hyphenate),
        poetry_outdent: z.boolean().catch(defaults.poetry_outdent),
        text_color: z.string().nullable().catch(defaults.text_color),
        columns: z.boolean().nullable().catch(defaults.columns),
        story_emphasis: z.boolean().catch(defaults.story_emphasis),
        story_emphasis_color: z.string().nullable().catch(defaults.story_emphasis_color),
        story_layout: z.enum(['single', 'grid']).catch(defaults.story_layout),
        story_alternate: z.boolean().catch(defaults.story_alternate),

        // Title pages
        titlepage_frame: z.string().nullable().catch(defaults.titlepage_frame),
        titlepage_color_text: z.string().nullable().catch(defaults.titlepage_color_text),
        titlepage_color_icon: z.string().nullable().catch(defaults.titlepage_color_icon),
        titlepage_color_frame: z.string().nullable().catch(defaults.titlepage_color_frame),
        titlepage_font: z.string().nullable().catch(defaults.titlepage_font),
        titlepage_text_size: z.number().catch(defaults.titlepage_text_size),
        titlepage_icon_size: z.number().catch(defaults.titlepage_icon_size),
        titlepage_always: z.enum(['left', 'right']).nullable().catch(defaults.titlepage_always),

        // Images
        image_style: z.enum(['borderless', 'padded', 'painted', 'torn']).catch(defaults.image_style),

        // Spacing
        margin_unit: z.enum(['mm', 'inch']).catch(defaults.margin_unit),
        margin_top: z.number().catch(defaults.margin_top),
        margin_bottom: z.number().catch(defaults.margin_bottom),
        margin_inner: z.number().catch(defaults.margin_inner),
        margin_outer: z.number().catch(defaults.margin_outer),
        margin_gutter_auto: z.boolean().catch(defaults.margin_gutter_auto),
        column_gap: z.number().catch(defaults.column_gap),

        // Legal
        public_domain: z.boolean().catch(defaults.public_domain),
        app_link: z.boolean().catch(defaults.app_link),
        design_link: z.boolean().catch(defaults.design_link),

    }).catch(() => defaults)
}
