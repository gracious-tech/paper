
import {PassageReference, books_ordered} from '@gracious.tech/fetch-client'
import {cloneDeep} from 'lodash-es'
import {make_blueprint_schema} from 'paper-bible-typst'
import {get_service, get_common_sizes} from 'printing-services'
import type {BindingTypeId} from 'printing-services'

import {content} from '@/services/content'
import {blue} from '@/services/state'

import type {Blueprint, ContentItem, ContentPassage} from '@/services/types'


// Default blueprint for 1st use, reset, and base for saved old blueprint versions
export function get_default_blueprint():Blueprint{

    return {

        title: '',

        // Cover (null = no cover)
        cover: null,

        // Printing
        service_id: 'home',
        size_id: 'a4',
        binding_type: 'paperback',
        ink_type: 'bw',
        paper_type: 'white',
        custom_unit: 'mm',
        custom_trim_width: 152,
        custom_trim_height: 229,
        custom_bleed: 3,
        custom_spine: 10,
        booklet: true,
        booklet_portrait: false,

        // Content
        content: [],
        bibles: [content.collection.get_preferred_resource().id],
        bibles_layout: 'columns',
        bibles_align: 'paragraph',

        // Features
        show_headings: true,
        show_headings_bold: true,
        show_headings_italic: false,
        show_headings_size: 0.9,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        running_pages: true,
        running_headings: true,
        running_position: 'footer',
        running_align: 'center',
        show_footnotes: true,
        show_wj: false,
        show_wj_color: '#cc0000',
        show_wj_bold: false,
        show_wj_italic: false,
        show_lines: true,
        notes: null,
        crossref: null,
        half_blank: null,
        passage_title: 'heading',

        // Style
        font_text: "Crimson Pro",
        font_text2: null,
        font_headings: null,

        // Max pages 30 (15 sheets) but ideally not greater than 20 (10 sheets)
        font_size: 10,  // Pref 10, lowest 8
        font_size2: null,
        line_height: 1.75,  // Pref 1.75, lowest 1.5

        justify: null,
        hyphenate: true,
        text_color: null,
        columns: null,
        story_emphasis: true,
        story_emphasis_color: '#4862ad',
        story_layout: 'single',
        story_alternate: false,

        // Title pages
        titlepage_frame: 'straight',
        titlepage_color_text: null,
        titlepage_color_icon: null,
        titlepage_color_frame: null,
        titlepage_font: null,
        titlepage_icon_size: 1,
        titlepage_always: 'right',

        // Images
        image_style: 'padded',

        // Spacing
        margin_unit: 'mm',
        margin_top: 10,
        margin_bottom: 10,
        margin_inner: 10,
        margin_outer: 10,
        column_gap: 5,

        // Legal
        public_domain: true,
        app_link: true,
    }
}


// Take untrusted input (e.g. Firestore doc data written by co-editors) and ensure a valid
// blueprint is returned — invalid/missing fields fall back to defaults, invalid content items
// are dropped (see the shared schema in paper-bible-typst). Cloned so the result never shares
// references with the input (ProseMirror docs pass through the schema by reference)
export function clean_blueprint(blueprint:unknown):Blueprint{
    const valid = cloneDeep(make_blueprint_schema(get_default_blueprint()).parse(blueprint))

    // Ensure bibles still exist
    valid.bibles = valid.bibles.filter(b => b in content.translations) as [string, ...string[]]
    if (!valid.bibles.length){
        valid.bibles.push(content.collection.get_preferred_resource().id)
    }

    return valid
}


// Collect the distinct book codes referenced by all scripture in the content — both standalone
// passage items and the passage slides of picture stories — so book content can be preloaded and
// availability/attribution checks cover every passage the document shows
export function collect_passage_books(items:ContentItem[]):string[]{
    const books = new Set<string>()
    for (const item of items){
        if (item.type === 'passage'){
            books.add(item.book)
        } else if (item.type === 'picture_story'){
            for (const slide of item.slides){
                if (slide.mode === 'passage' && slide.book){
                    books.add(slide.book)
                }
            }
        }
    }
    return [...books]
}


// Whether a translation has zero available books in the given testament (common for NT-only/
// OT-only translations, or ones still being digitized)
function testament_unavailable(bible:string, testament:'ot'|'nt'):boolean{
    const books = content.books[bible]
    if (!books){
        return false
    }
    return !Object.values(books).some(book => book[testament] && book.available)
}


// One warning per translation missing at least one of the given books, naming exactly what's
// missing — a whole missing testament collapses to a single "Old/New Testament" label instead of
// listing every book, since translations are commonly NT-only, OT-only, or partly digitized.
// `t` is the caller's own useI18n() translator, since these strings mix translated labels with
// untranslated book/translation names
export function missing_book_warnings(
    book_ids:string[], bibles:readonly string[], t:(key:string) => string,
):string[]{
    const warnings:string[] = []
    for (const bible of bibles){
        const bible_books = content.books[bible]
        if (!bible_books){
            continue  // Not loaded yet
        }
        const missing = book_ids.filter(id => !bible_books[id]?.available)
        if (!missing.length){
            continue
        }

        // Collapse whichever testaments are entirely unavailable into a single label each
        const covered = new Set<string>()
        const labels:string[] = []
        for (const testament of ['ot', 'nt'] as const){
            const testament_missing = missing.filter(id => bible_books[id]?.[testament])
            if (testament_missing.length && testament_unavailable(bible, testament)){
                labels.push(testament === 'ot' ? t("Old Testament") : t("New Testament"))
                for (const id of testament_missing){
                    covered.add(id)
                }
            }
        }
        for (const id of missing){
            if (!covered.has(id)){
                labels.push(bible_books[id]!.name)
            }
        }

        const trans = content.translations[bible]
        const name = trans?.name_local || trans?.name_english || bible
        warnings.push(`${name} ${t("doesn't include")}: ${labels.join(', ')}`)
    }
    return warnings
}


// Cheap boolean version of missing_book_warnings(), for disabling actions without building the
// full warning text
export function has_missing_books(book_ids:string[], bibles:readonly string[]):boolean{
    return bibles.some(bible => {
        const bible_books = content.books[bible]
        if (!bible_books){
            return false  // Not loaded yet
        }
        return book_ids.some(id => !bible_books[id]?.available)
    })
}


// Generate name for content item. `bible` defaults to the currently-open design's first bible
// (for use while editing `blue`) but callers summarising a *different* design (e.g. a list row)
// should pass that design's own bible instead. `abbreviate` shortens passage references (e.g.
// "Gen 1-3"), for compact previews
export function gen_content_name(item:ContentItem, bible=blue.bibles[0], abbreviate=false):string{
    if (item.type === 'passage'){
        return content.collection.reference_to_string(new PassageReference(item), bible, abbreviate)
    } else if (item.type === 'custom' && item.name){
        return item.name
    } else if (item.type === 'title'){
        return item.title
    } else if (item.type === 'picture_story'){
        return item.title || "Picture story"
    }
    return "Nameless"
}


// Whether a content item is a passage selecting an entire book (all 4 range fields null) — the
// convention the new-design wizard's book picker uses (see new_design.ts) for "whole book"
function is_whole_book(item:ContentItem):item is ContentPassage{
    return item.type === 'passage' && item.start_chapter === null && item.start_verse === null
        && item.end_chapter === null && item.end_verse === null
}


// Abbreviated passage-only preview of a design's content, for a compact list-row subtitle —
// custom/title items (copyright notices, section titles, etc.) are deliberately omitted, since
// they're not what a user scans for when picking a design. Picture stories collapse to a single
// reference spanning their first to last referenced passage, or "Custom text" if they reference
// none at all. Whole-book passages that together cover an entire testament (or the whole canon)
// collapse further into a single "OT"/"NT"/"Whole bible" label rather than listing every book
export function content_preview(items:ContentItem[], bible=blue.bibles[0]):string{
    const whole_books = new Set(items.filter(is_whole_book).map(item => item.book))
    const ot_ids = books_ordered.slice(0, 39)
    const nt_ids = books_ordered.slice(39)
    if (books_ordered.every(id => whole_books.has(id))){
        return "Whole bible"
    }
    const whole_ot = ot_ids.every(id => whole_books.has(id))
    const whole_nt = nt_ids.every(id => whole_books.has(id))
    const covered = new Set([...(whole_ot ? ot_ids : []), ...(whole_nt ? nt_ids : [])])

    // Items still needing their own reference label after any OT/NT collapsing above —
    // abbreviating (e.g. "Gen" instead of "Genesis") only earns its keep once several
    // references have to be packed onto one line, so skip it when there's just one
    const remaining = items.filter(item => {
        if (item.type === 'passage'){
            return !(is_whole_book(item) && covered.has(item.book))
        }
        return item.type === 'picture_story'
    })
    const abbreviate = (whole_ot ? 1 : 0) + (whole_nt ? 1 : 0) + remaining.length > 1

    const parts:string[] = []
    if (whole_ot){
        parts.push("OT")
    }
    if (whole_nt){
        parts.push("NT")
    }
    for (const item of remaining){
        if (item.type === 'passage'){
            parts.push(gen_content_name(item, bible, abbreviate))
        } else if (item.type === 'picture_story'){
            const passages = item.slides.filter(slide => slide.mode === 'passage' && slide.book)
            if (!passages.length){
                parts.push("Custom text")
                continue
            }
            const range = PassageReference.from_refs(
                new PassageReference(passages[0]!), new PassageReference(passages.at(-1)!))
            parts.push(content.collection.reference_to_string(range, bible, abbreviate))
        }
    }
    return parts.join(', ')
}


// Format a size's dimensions for display, e.g. "152 × 229 mm" or "6 × 9 in"
export function format_dims(width:number, height:number, unit:string):string{
    const u = unit === 'mm' ? 'mm' : 'in'
    const fmt = (v:number) => u === 'mm' ? String(Math.round(v)) : String(v)
    return `${fmt(width)} × ${fmt(height)} ${u}`
}


// Describes how a page count fails a binding's supported range: too few pages (below
// `min_pages`) or too many (above `max_pages`), and the limit that was crossed. Includes the
// binding's display name since warnings may be shown away from the binding selector itself
export interface BindingPageIssue {
    name:string
    fewer:boolean
    limit:number
}


// Whether a blueprint's chosen binding doesn't support the given page count, and if so whether
// the document has too few or too many pages for it. Used for warnings only — the binding is
// never auto-switched, as page count is derived from the document (estimated during design,
// actual once compiled). Home/custom modes and services without a defined range for the chosen
// binding have no such constraint to violate
export function binding_page_issue(blueprint:Blueprint, pages:number):BindingPageIssue|null{
    if (blueprint.service_id === 'home' || blueprint.service_id === 'custom'){
        return null
    }
    const service = get_service(blueprint.service_id as Parameters<typeof get_service>[0])
    const limits = service?.raw.binding_types[blueprint.binding_type as BindingTypeId]
    if (!service || !limits){
        return null
    }
    const name = service.get_binding_types().find(b => b.id === blueprint.binding_type)?.name
        ?? blueprint.binding_type
    if (pages < limits.min_pages){
        return {name, fewer: true, limit: limits.min_pages}
    }
    if (pages > limits.max_pages){
        return {name, fewer: false, limit: limits.max_pages}
    }
    return null
}


// Resolve a blueprint's trim size (named or custom) to a display label, e.g. "A4 (210 × 297 mm)".
// `short` drops the dimensions when a named size is found (e.g. just "A4"), for compact chips —
// custom sizes have no name to fall back to, so they always show dimensions regardless
export function format_paper_size(
        blueprint:Pick<Blueprint, 'service_id'|'size_id'|'custom_unit'|'custom_trim_width'
            |'custom_trim_height'>, short=false):string{
    if (blueprint.size_id === ''){
        return format_dims(blueprint.custom_trim_width, blueprint.custom_trim_height,
            blueprint.custom_unit)
    }
    const use_common = blueprint.service_id === 'custom' || blueprint.service_id === 'home'
    const sizes = use_common
        ? get_common_sizes({numbers: 'number'})
        : get_service(blueprint.service_id as Parameters<typeof get_service>[0])
            .get_sizes({numbers: 'number', all: true})
    const size = sizes.find(s => s.id === blueprint.size_id)
    if (!size){
        return format_dims(blueprint.custom_trim_width, blueprint.custom_trim_height,
            blueprint.custom_unit)
    }
    if (short){
        return size.name
    }
    return `${size.name} (${format_dims(size.width, size.height, size.unit)})`
}


// The passage content items in a blueprint, for summarising what's included
export function get_passages(blueprint:Blueprint):ContentPassage[]{
    return blueprint.content.filter((item):item is ContentPassage => item.type === 'passage')
}


// Printing service pill label, e.g. a real service's name, or "Booklet (fold at home)"/"Home"/
// "Custom…" for the service-less modes. `t` is the caller's own useI18n() translator (see
// missing_book_warnings() above for why these helpers take it rather than importing vue-i18n).
// `short` drops the explanatory parenthetical/ellipsis, for compact chips
export function format_service_label(blueprint:Pick<Blueprint, 'service_id'|'booklet'>,
        t:(key:string) => string, short=false):string{
    const {service_id, booklet} = blueprint
    if (service_id === 'home'){
        if (booklet){
            return short ? t("Booklet") : t("Booklet (fold at home)")
        }
        return t("Home")
    }
    if (service_id === 'custom'){
        return short ? t("Custom") : t("Custom…")
    }
    return get_service(service_id as Parameters<typeof get_service>[0]).name
}


// Page-count pill label, only once a version has finished rendering (null pages = not yet
// rendered). Booklets store the imposed sheet-side count (2 content pages per side), so double
// it back to the number of pages the reader actually sees once printed/folded, with the physical
// sheet count alongside
export function format_pages_label(pages:number|null, booklet:boolean,
        t:(key:string) => string):string|null{
    if (pages == null){
        return null
    }
    if (!booklet){
        return `${pages} ${t("pages")}`
    }
    const content_pages = pages * 2
    const sheets = Math.ceil(pages / 2)
    return `${content_pages} ${t("pages")} (${sheets} ${t("sheets")})`
}
