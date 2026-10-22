
// Example designs offered from the empty designs-list preview pane (see DisplayExamples.vue) —
// each is a real, ready-to-print Blueprint a new user can create with one click rather than
// stepping through the wizard. Diffs mirror new_design.ts's TYPE_PRESETS convention: only the
// fields that differ from the default blueprint are listed.

import {books_ordered} from '@gracious.tech/fetch-client'

import {content} from '@/services/content'
import {get_default_blueprint, font_default_for_bibles, guess_paper_size, default_bible}
    from '@/services/blueprints'
import {seed_cover_preset} from '@/services/cover'
import {generate_token} from '@/services/utils'
import {locale} from '@/services/i18n'
import {create_design} from '@/services/designs'
import img_study from '@/assets/images/examples/study.webp'
import img_bilingual from '@/assets/images/examples/bilingual.webp'
import img_journal from '@/assets/images/examples/journal.webp'
import img_large_print from '@/assets/images/examples/large_print.webp'
import img_greek from '@/assets/images/examples/greek.webp'
import img_nt_reading from '@/assets/images/examples/nt_reading.webp'

import type {Blueprint, ContentCustom, ContentPassage} from '@/services/types'
import type {CoverPreset} from '@/services/cover'
import type {Translate} from '@/services/i18n'


// A single example — every one gets a real bookcover (never just a title page), seeded from one
// of the wizard's own style presets and then refined with `cover_overrides` (specific
// `EmbedFormState` field values collected by hand via the cover editor's console diff — see
// log_cover_diff() in DialogCoverEditor.vue). `image` is a bundled preview of the result (webp,
// downscaled for display — the full-size renders are kept in assets/images/examples/originals/)
export interface ExampleDesign {
    id:string
    image:string
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
        id: 'study', image: img_study, books: ['eph'], cover: 'pattern',
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
        id: 'bilingual', image: img_bilingual, books: ['mrk'], trans: ['cmn_bibs'],
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
        id: 'journal', image: img_journal, books: ['pro'], cover: 'photo', message: true,
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
        id: 'large_print', image: img_large_print, books: ['1ki', '2ki'], cover: 'photo',
        cover_overrides: {
            title1: '1 & 2 Kings', title1_font: 'Merriweather', title1_size: 1.95,
            subtitle_font: 'Noto Sans', subtitle_size: 1.56, subtitle_weight: 400,
        },
        cover_bg_image: 'lion.jpg',
        diff: {
            font_size: 15, line_height: 1.5, justify: false, service_id: 'lulu',
            size_id: 'us_trade',
        },
    },
    {
        id: 'greek', image: img_greek, books: ['1jn'], trans: ['grc_sr'], trans_first: true,
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
        id: 'nt_reading', image: img_nt_reading, books: [...books_ordered.slice(39)],
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


// One whole-book ContentPassage per given book id, in the Bible's own canonical order regardless
// of the order given — mirrors new_design.ts's book-mode content building
function whole_books(book_ids:string[]):ContentPassage[]{
    const selected = new Set(book_ids)
    const canonical = content.collection
        .get_books(default_bible(), {whole: true})
        .map(book => book.id)
        .filter(id => selected.has(id))
    return canonical.map(book => ({
        type: 'passage', id: generate_token(), book,
        start_chapter: null, start_verse: null, end_chapter: null, end_verse: null,
        title: null, title_subtitle: '', title_icon: null, image: null,
    }))
}


// A centered, italic dedication page for the user to personalise
function personal_message_item(t:Translate):ContentCustom{
    return {
        type: 'custom',
        id: generate_token(),
        name: t("svc.examples.message_name"),
        doc: {type: 'doc', content: [{
            type: 'paragraph',
            attrs: {textAlign: 'center'},
            content: [
                {type: 'text', text: t("svc.examples.message_body"), marks: [{type: 'italic'}]},
            ],
        }]},
        position: 'middle',
    }
}


// Build a real Blueprint for an example: defaults, its diff, its content, then a cover carrying
// the example's own title/subtitle (there's no wizard title field involved here, so it's staged
// directly rather than through blueprint.name). `message` is the example's translated opening
// message page, if it has one. `bible` is the translation the example is read in (beside any
// of its own, see `trans`)
export function build_example_blueprint(example:ExampleDesign, title:string, subtitle:string,
        message:ContentCustom|null, bible:string):Blueprint{
    const blueprint = get_default_blueprint()
    blueprint.bibles = [bible]
    Object.assign(blueprint, example.diff)
    // Examples printed at home don't pin a size themselves — default to the user's likely
    // printer paper size rather than always A4 (professional trims are unaffected, since those
    // examples set size_id explicitly in their diff)
    if (blueprint.service_id === 'home' && !('size_id' in example.diff)){
        blueprint.size_id = guess_paper_size()
    }
    // Only home printing folds a booklet, as in the wizard. Settled before the cover is seeded
    // below, whose defaults are sized from the reading page — which a booklet halves
    blueprint.booklet = blueprint.service_id === 'home'

    // The user's translation leads, so the printed copyright page and headings are in their
    // language; the example's own translation(s) follow (unless `trans_first`), leaving out the
    // one they read already
    if (example.trans){
        const others = example.trans.filter(id => id !== bible)
        blueprint.bibles = example.trans_first && others[0]
            ? [others[0], ...others.slice(1), bible] : [bible, ...others]
    }
    blueprint.font_text = font_default_for_bibles(blueprint.bibles)

    blueprint.content = whole_books(example.books)
    if (message){
        blueprint.content.unshift(message)
    }

    // Staged on `name` since that's what seed_cover_preset() reads the title from (see
    // build_new_blueprint() for the same pattern)
    blueprint.name = title
    const cover = seed_cover_preset(example.cover, blueprint)
    Object.assign(cover.form, example.cover_overrides)
    if (example.cover_bg_image){
        cover.bg_image = {kind: 'builtin', id: example.cover_bg_image}
    }
    cover.form['subtitle'] = subtitle
    cover.title_custom = true
    blueprint.cover = cover
    blueprint.name = ''

    return blueprint
}


// Create and open a real design from an example, ready to refine further or print as-is. Its
// cover and message page are written in the app's language, so it's read in a translation in
// that language too, rather than the browser's preferred one (the two differ once a language is
// picked by hand) — else its printed copyright page and chapter headings, which follow the
// Bible, wouldn't match its own cover
export function create_example_design(id:string, t:Translate):Promise<string>{
    const example = EXAMPLE_DESIGNS.find(item => item.id === id)!
    const {title, subtitle} = example_label(id, t)
    const message = example.message ? personal_message_item(t) : null
    const bible = content.collection.get_preferred_resource([locale.value]).id
    return create_design(build_example_blueprint(example, title, subtitle, message, bible))
}
