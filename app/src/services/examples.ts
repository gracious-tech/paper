
// Building and creating the example designs (defined in example_designs.ts) — each is a real,
// ready-to-print Blueprint a new user can create with one click rather than stepping through the
// wizard. Diffs mirror new_design.ts's TYPE_PRESETS convention: only the fields that differ from
// the default blueprint are listed.

import {content} from '@/services/content'
import {get_default_blueprint, font_default_for_bibles, guess_paper_size, default_bible}
    from '@/services/blueprints'
import {seed_cover_preset} from '@/services/cover'
import {generate_token} from '@/services/utils'
import {locale} from '@/services/i18n'
import {create_design} from '@/services/designs'
import {EXAMPLE_DESIGNS, example_label} from '@/services/example_designs'

import type {Blueprint, ContentCustom, ContentPassage} from '@/services/types'
import type {Translate} from '@/services/i18n'
import type {ExampleDesign} from '@/services/example_designs'


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
