
// The example designs offered from the empty designs-list preview pane (see DisplayExamples.vue)
// and their translated labels — the data alone, with no app services behind it, so tools and
// tests can read it too. Building and creating a design from one is examples.ts's job

import {books_ordered} from '@gracious.tech/fetch-client'

import type {Blueprint} from '@/services/types'
import type {CoverPreset} from '@/services/cover'
import type {Translate} from '@/services/i18n'


// A single example — every one gets a real bookcover (never just a title page), seeded from one
// of the wizard's own style presets and then refined with `cover_overrides` (specific
// `EmbedFormState` field values collected by hand via the cover editor's console diff — see
// log_cover_diff() in DialogCoverEditor.vue). Its card shows a 3D picture of the resulting cover
// in the UI's language (see example_images.ts), which .bin/gen_example_images re-renders after
// any change here or to the titles' translations. `pages` is the book's length (from a real
// compile in English), which only sizes the spine in that picture
export interface ExampleDesign {
    id:string
    pages:number
    books:string[]  // Whole-book passages; canonical order is applied at build regardless of order here
    // Extra translation(s) following the user's own, by fetch.bible resource id
    trans?:[string, ...string[]]
    // Lead with `trans` instead, for an original-language study edition (whose front matter
    // still prints in the user's language, since doc_language() passes classical languages over)
    trans_first?:boolean
    cover:CoverPreset
    cover_overrides?:Record<string, unknown>
    // Builtin background filename, overriding the 'photo' preset's own book-themed pick — not
    // part of `cover.form` so it can't travel through cover_overrides (see CoverConfig)
    cover_bg_image?:string
    // Open with a generic personal message page for the user to fill in (gift editions)
    message?:boolean
    diff:Partial<Blueprint>
}


export const EXAMPLE_DESIGNS:ExampleDesign[] = [
    {
        id: 'study', pages: 20, books: ['eph'], cover: 'pattern',
        cover_overrides: {
            title1_font: 'Noto Sans', title1_size: 2, title1_color: '#ffffff',
            subtitle_font: 'Noto Sans', subtitle_size: 1.84, subtitle_color: '#ffffff',
            bg_color: '#73b49f', icon_id: 'mdi:shield-cross-outline', icon_mode: 'center',
            icon_size: 1.05, icon_color: '#ffffff', pattern_id: 'texture', pattern_scale: 2.17,
            bg_vector_id: 'stripes', blurb_bg_color: null,
        },
        diff: {show_footnotes: false, notes: 'eng_tyndale'},
    },
    {
        id: 'bilingual', pages: 86, books: ['mrk'], trans: ['cmn_bibs'],
        cover: 'photo',
        cover_overrides: {
            title1_color: '#dcfaff', title_margin_top: 1,
            subtitle_size: 3.03, subtitle_color: '#dbfaff', subtitle_margin_top: 1,
            blurb_bg_color: '#dbfaff',
        },
        // Chinese follows and fits a verse in far less space than most languages, so it's the
        // larger of the two, keeping the aligned columns roughly the same length
        diff: {
            show_footnotes: false, service_id: 'lulu', font_size2: 1.2, line_height2: 1.1,
            size_id: 'digest',
        },
    },
    {
        id: 'journal', pages: 131, books: ['pro'], cover: 'photo', message: true,
        cover_overrides: {
            title1_font: 'Caveat', title1_size: 2.71, title1_weight: 400, title_margin_top: 0,
            subtitle_font: 'Caveat', subtitle_size: 1.69, subtitle_weight: 400,
            subtitle_margin_top: 0,
        },
        diff: {
            show_footnotes: false, half_blank: 'right', bibles_layout: 'columns',
            service_id: 'lulu', size_id: 'digest', binding_type: 'paperback_coil',
            columns: false,
        },
    },
    {
        id: 'large_print', pages: 296, books: ['1ki', '2ki'], cover: 'photo',
        cover_overrides: {
            title1_font: 'Merriweather', title1_size: 1.95,
            subtitle_font: 'Noto Sans', subtitle_size: 1.56, subtitle_weight: 400,
        },
        cover_bg_image: 'lion.jpg',
        diff: {
            font_size: 15, line_height: 1.5, justify: false, service_id: 'lulu',
            size_id: 'us_trade',
        },
    },
    {
        id: 'greek', pages: 12, books: ['1jn'], trans: ['grc_sr'], trans_first: true,
        cover: 'pattern',
        cover_overrides: {
            bg_color: '#f7e7e3', pattern_id: 'diagonal-lines', bg_vector_id: 'church-v2',
        },
        diff: {
            font_size: 9, line_height: 1.2, show_headings: false, show_footnotes: false,
            bibles_align: 'verse',
        },
    },
    {
        id: 'nt_reading', pages: 441, books: [...books_ordered.slice(39)],
        cover: 'pattern',
        cover_overrides: {
            title1_font: 'Dancing Script', title1_size: 2.23,
            subtitle_font: 'Noto Sans', subtitle_weight: 400,
            bg_color: '#f7cfff', bg_color_gradient: true, bg_vector_id: 'calvary-hill-v2',
        },
        diff: {
            columns: false, show_headings: false, show_chapters: false, show_verses: false,
            show_footnotes: false, service_id: 'lulu', size_id: 'us_trade',
        },
    },
]


// The Noto family of the same style standing in for each decorative font the examples' covers
// use, outside English: those fonts cover Latin at best (Dancing Script has no Cyrillic, and
// Vietnamese mixes faces mid-word), whereas from a Noto family bookcover falls back to the Noto
// font matching each script the text needs, in the same style
export const NOTO_STAND_INS:Record<string, string> = {
    'Caveat': 'Noto Sans',
    'Dancing Script': 'Noto Serif',
    'Merriweather': 'Noto Serif',
}


// An example's cover overrides for a UI locale, with its decorative fonts swapped for their Noto
// stand-ins in any language but English
export function example_cover_overrides(example:ExampleDesign, locale:string)
        :Record<string, unknown>{
    const overrides = {...example.cover_overrides}
    if (locale.split('-')[0] === 'en'){
        return overrides
    }
    for (const [key, value] of Object.entries(overrides)){
        if (key.endsWith('_font') && typeof value === 'string' && value in NOTO_STAND_INS){
            overrides[key] = NOTO_STAND_INS[value]
        }
    }
    return overrides
}


// Display text per example, translated — hoisted out the same way new_design.ts's
// wizard_type_label() is, so the display component and the blueprint builder below (which needs
// the title/subtitle to seed the cover) share one source
export function example_label(id:string, t:Translate):
        {title:string, subtitle:string, blurb:string}{
    const labels:Record<string, {title:string, subtitle:string, blurb:string}> = {
        study: {
            title: t("svc.examples.study_title"),
            subtitle: t("svc.examples.study_subtitle"),
            blurb: t("svc.examples.study_blurb"),
        },
        bilingual: {
            title: t("svc.examples.bilingual_title"),
            // Hardcoded, not translated — it's the Chinese title itself, not UI text describing it
            subtitle: '马可福音',
            blurb: t("svc.examples.bilingual_blurb"),
        },
        journal: {
            title: t("svc.examples.journal_title"),
            subtitle: t("svc.examples.journal_subtitle"),
            blurb: t("svc.examples.journal_blurb"),
        },
        large_print: {
            title: t("svc.examples.large_print_title"),
            subtitle: t("svc.examples.large_print_subtitle"),
            blurb: t("svc.examples.large_print_blurb"),
        },
        greek: {
            title: t("svc.examples.greek_title"),
            subtitle: t("svc.examples.greek_subtitle"),
            blurb: t("svc.examples.greek_blurb"),
        },
        nt_reading: {
            title: t("svc.examples.nt_reading_title"),
            subtitle: t("svc.examples.nt_reading_subtitle"),
            blurb: t("svc.examples.nt_reading_blurb"),
        },
    }
    return labels[id]!
}
