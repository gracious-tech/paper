
// Shared stress-test tiers: the same Blueprints are compiled in the browser (WASM worker, see
// stress_wasm.test.ts) and via the server pipeline (Typst CLI, see stress_server.ts), so the
// results of both paths are directly comparable.

import type {Blueprint, ContentItem} from 'paper-bible-typst'


// Translation used for all tiers (must exist on the dev content server — see its manifest.json)
export const STRESS_BIBLE = 'eng_bsb'


// Canonical fetch.bible book ids (USX codes), in manifest books_ordered order
export const OT_BOOKS = [
    'gen', 'exo', 'lev', 'num', 'deu', 'jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch',
    '2ch', 'ezr', 'neh', 'est', 'job', 'psa', 'pro', 'ecc', 'sng', 'isa', 'jer', 'lam', 'ezk',
    'dan', 'hos', 'jol', 'amo', 'oba', 'jon', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal',
]
export const NT_BOOKS = [
    'mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal', 'eph', 'php', 'col', '1th',
    '2th', '1ti', '2ti', 'tit', 'phm', 'heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud',
    'rev',
]


// One document size to stress (whole books only, smallest tier first)
export interface Tier {
    id:string
    books:string[]
}


// Resolve the tiers a harness should run: the standard ladder, or a single custom tier when
// STRESS_BOOKS is set (e.g. STRESS_BOOKS="psa,pro" to probe specific books)
export function get_tiers():Tier[] {
    const env = process.env['STRESS_BOOKS']
    if (env){
        const books = env.split(',').map(book => book.trim()).filter(Boolean)
        return [{id: `custom_${books.join('_')}`, books}]
    }
    return TIERS
}


// The tiers both harnesses run, in order — large tiers are where the WASM path is expected to
// start needing the server fallback
export const TIERS:Tier[] = [
    {id: 'titus', books: ['tit']},
    {id: 'john', books: ['jhn']},
    {id: 'gospels_acts', books: ['mat', 'mrk', 'luk', 'jhn', 'act']},
    {id: 'new_testament', books: NT_BOOKS},
    {id: 'old_testament', books: OT_BOOKS},
    {id: 'full_bible', books: [...OT_BOOKS, ...NT_BOOKS]},
]


// Build a realistic print blueprint for a list of whole books. Mirrors the app's default
// blueprint (see app/src/services/blueprints.ts) except: book arrangement rather than booklet
// (that's what large documents realistically use) and per-book titles instead of a title page.
// `overrides` lets the config matrix (see matrix.ts) vary individual layout options.
export function build_blueprint(tier:Tier, overrides:Partial<Blueprint> = {}):Blueprint {

    // One whole-book passage item per book
    const content:ContentItem[] = tier.books.map((book, index) => ({
        type: 'passage',
        id: `stress_${index}_${book}`,
        book,
        start_chapter: null,
        start_verse: null,
        end_chapter: null,
        end_verse: null,
        title: true,
    }))

    return {

        title: `Stress ${tier.id}`,

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
        booklet: false,
        booklet_portrait: false,

        // Content
        content,
        bibles: [STRESS_BIBLE],
        bibles_layout: 'columns',
        bibles_align: 'paragraph',

        // Features (the app defaults)
        show_headings: true,
        show_headings_bold: true,
        show_headings_italic: false,
        show_headings_size: 0.9,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        show_pages: true,
        show_footnotes: true,
        show_wj: false,
        show_wj_color: '#cc0000',
        show_wj_bold: false,
        show_wj_italic: false,
        show_lines: true,
        notes: null,
        crossref: null,
        half_blank: null,

        // Style
        font_text: "Crimson Pro",
        font_text2: null,
        font_headings: null,
        font_titles: null,
        font_size: 10,
        line_height: 1.75,
        justify: null,
        text_color: null,
        columns: null,

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

        ...overrides,
    }
}
