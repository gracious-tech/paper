
import {z} from 'zod'

import type {PmDoc} from 'pm-to-typst'
import type {Blueprint, ContentItem, CoverConfig} from './types.js'


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


// Decorative title page item
const content_title_schema = z.object({
    type: z.literal('title'),
    id: z.string().min(1),
    title: z.string(),
    subtitle: z.string(),
    icon: z.string().nullable(),
    icon_size: z.number(),
    pattern: z.string(),
    color_primary: z.string().nullable(),
    color_secondary: z.string().nullable(),
    alone: z.boolean(),
}) satisfies z.ZodType<ContentItem>


// Bible passage reference item
const content_passage_schema = z.object({
    type: z.literal('passage'),
    id: z.string().min(1),
    book: z.string().min(1),
    start_chapter: z.number().nullable(),
    start_verse: z.number().nullable(),
    end_chapter: z.number().nullable(),
    end_verse: z.number().nullable(),
    title: z.boolean(),
}) satisfies z.ZodType<ContentItem>


// Custom rich-text page item
const content_custom_schema = z.object({
    type: z.literal('custom'),
    id: z.string().min(1),
    name: z.string(),
    doc: pm_doc_schema,
    position: z.enum(['top', 'middle', 'bottom']),
}) satisfies z.ZodType<ContentItem>


// Cover config — the widget form is only validated shallowly; the cover renderer re-parses
// the derived schema with bookcover's own zod schema, so a bad co-editor value can only
// break its own cover render (never the book compile)
const cover_config_schema = z.object({
    form: z.record(z.string(), z.unknown()),
    bg_image_path: z.string().nullable(),
    bg_image_hash: z.string().nullable(),
    font_families: z.array(z.string()),
}) satisfies z.ZodType<CoverConfig>


// Any single content item
const content_item_schema = z.discriminatedUnion('type',
    [content_title_schema, content_passage_schema, content_custom_schema])


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

        title: z.string().catch(defaults.title),

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
        show_pages: z.boolean().catch(defaults.show_pages),
        show_footnotes: z.boolean().catch(defaults.show_footnotes),
        show_wj: z.boolean().catch(defaults.show_wj),
        show_wj_color: z.string().nullable().catch(defaults.show_wj_color),
        show_wj_bold: z.boolean().catch(defaults.show_wj_bold),
        show_wj_italic: z.boolean().catch(defaults.show_wj_italic),
        show_lines: z.boolean().catch(defaults.show_lines),
        notes: z.string().nullable().catch(defaults.notes),
        crossref: z.enum(['small', 'medium', 'large']).nullable().catch(defaults.crossref),
        half_blank: z.enum(['left', 'right']).nullable().catch(defaults.half_blank),

        // Style
        font_text: z.string().catch(defaults.font_text),
        font_text2: z.string().nullable().catch(defaults.font_text2),
        font_headings: z.string().nullable().catch(defaults.font_headings),
        font_titles: z.string().nullable().catch(defaults.font_titles),
        font_size: z.number().catch(defaults.font_size),
        line_height: z.number().catch(defaults.line_height),
        justify: z.boolean().nullable().catch(defaults.justify),
        text_color: z.string().nullable().catch(defaults.text_color),
        columns: z.boolean().nullable().catch(defaults.columns),

        // Spacing
        margin_unit: z.enum(['mm', 'in']).catch(defaults.margin_unit),
        margin_top: z.number().catch(defaults.margin_top),
        margin_bottom: z.number().catch(defaults.margin_bottom),
        margin_inner: z.number().catch(defaults.margin_inner),
        margin_outer: z.number().catch(defaults.margin_outer),
        column_gap: z.number().catch(defaults.column_gap),

        // Legal
        public_domain: z.boolean().catch(defaults.public_domain),
        app_link: z.boolean().catch(defaults.app_link),

    }).catch(() => defaults)
}
