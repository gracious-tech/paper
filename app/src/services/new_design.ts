
// New-design wizard support: the per-step draft of user selections, the design-type presets,
// and the assembly of a final Blueprint from a completed draft (only done once, at finish)

import {PassageReference} from '@gracious.tech/fetch-client'

import {content} from '@/services/content'
import {get_default_blueprint} from '@/services/blueprints'
import {seed_cover_preset} from '@/services/cover'
import {book_icon} from '@/services/icons'
import {generate_token} from '@/services/utils'
import {fetch_stories, story_to_slides, story_reference_label, story_canonical_cmp}
    from '@/services/stories'
import img_type_regular from '@/assets/images/design_types/type_standard.avif'
import img_type_reading from '@/assets/images/design_types/type_reading.avif'
import img_type_notes from '@/assets/images/design_types/type_notes.avif'
import img_type_study from '@/assets/images/design_types/type_study.avif'
import img_type_bilingual from '@/assets/images/design_types/type_bilingual.avif'

import type {Blueprint, ContentPassage, ContentPictureStory, ContentTitle} from '@/services/types'


// The design types offered by the wizard's first step
export type NewDesignType = 'regular'|'reading'|'notes'|'study'|'bilingual'|'picture_story'


// The cover styles offered by the wizard's last step ('minimal' is home-printing only)
export type NewDesignCover = 'photo'|'pattern'|'icon'|'minimal'


// A single line of the free-text passage list (parsed eagerly so a tick can show validity;
// invalid lines keep their text so the user can fix them rather than losing the input)
export interface DraftPassage {
    id:string
    text:string  // Raw user input, kept editable
    book:string|null  // Parsed fields, or null/nulls if `text` isn't a recognised reference
    start_chapter:number|null
    start_verse:number|null
    end_chapter:number|null
    end_verse:number|null
}


// Per-step selections of the new-design wizard — assembled into a Blueprint only on finish,
// so going back and changing e.g. the type never needs to un-apply a previous choice
export interface NewDesignDraft {
    type:NewDesignType|null
    // Which of the two content sources below is used at build. For `picture_story`, 'books'
    // means the predefined story list (`stories`) rather than whole books
    book_mode:'books'|'passages'
    books:string[]  // fetch.bible book ids (order not significant; canonical order at build)
    stories:string[]  // Predefined picture-story ids (picture_story type only)
    passages:DraftPassage[]  // Free-text passages (order significant; kept even if not active,
                              // so toggling `book_mode` back and forth doesn't lose entries)
    bibles:string[]  // 1-2 translation ids
    service_id:string|null  // 'home' or a printing-services id ('custom' isn't offered here)
    size_id:string|null
    booklet:boolean  // Home printing only
    binding_type:string  // Professional printing only, as are ink/paper below
    ink_type:string
    paper_type:string
    cover:NewDesignCover|null
}


// A fresh draft — nothing decided yet beyond the home-printing defaults that mirror
// get_default_blueprint() (used if the user picks "home" and changes nothing further). Bibles
// starts empty (rather than pre-filled with the preferred translation) so the "Translations"
// step isn't marked complete until the user actually reaches it — see NewDesignBibles.vue
export function get_default_draft():NewDesignDraft{
    return {
        type: null,
        book_mode: 'books',
        books: [],
        stories: [],
        passages: [],
        bibles: [],
        service_id: null,
        size_id: null,
        booklet: true,
        binding_type: 'paperback',
        ink_type: 'bw',
        paper_type: 'white',
        cover: null,
    }
}


// The design-type presets: only the fields that differ from the blank default blueprint
// (diffs mirror the retired OptionsPreset panel; bilingual additionally requires a second
// translation, which the wizard's translations step enforces). picture_story has no artwork yet
export const TYPE_PRESETS:{id:NewDesignType, image:string, diff:Partial<Blueprint>}[] = [
    {id: 'regular', image: img_type_regular, diff: {}},
    {id: 'reading', image: img_type_reading, diff: {
        show_headings: false,
        show_chapters: false,
        show_verses: false,
        show_footnotes: false,
    }},
    {id: 'notes', image: img_type_notes, diff: {
        show_footnotes: false,
        line_height: 2.5,
        half_blank: 'right',
        bibles_layout: 'columns',  // Required for half_blank
    }},
    {id: 'study', image: img_type_study, diff: {
        show_footnotes: false,
        notes: 'eng_tyndale',
    }},
    {id: 'bilingual', image: img_type_bilingual, diff: {
        show_footnotes: false,
    }},
    {id: 'picture_story', image: '/wizard/type_picture_story.webp', diff: {
        hyphenate: false,
        line_height: 2,
    }},
]


// A decorative title page for the "minimal ink" cover choice, matching the shape the editor's
// own "Title page" button creates (title from the first passage, its book's icon)
function make_wizard_title_item(blueprint:Blueprint):ContentTitle{
    const passage = blueprint.content.find(
        (item):item is ContentPassage => item.type === 'passage')
    let title = ''
    if (passage){
        title = content.collection.reference_to_string(
            new PassageReference(passage), blueprint.bibles[0])
    }
    return {
        type: 'title',
        id: generate_token(),
        title,
        title_subtitle: "",
        title_icon: passage ? book_icon[passage.book]! : 'mdi:cross',
    }
}


// Assemble the final Blueprint from a completed draft: defaults, then the type preset's diff,
// then each step's selections. Content becomes whole-book passages in canonical order plus the
// auto-copyright statement (translations nearly always require attribution), with a title page
// prepended only for the minimal-ink cover choice. Async because the picture_story type looks up
// the predefined story list (already cached by the time the wizard reaches this step)
export async function build_new_blueprint(draft:NewDesignDraft):Promise<Blueprint>{

    const blueprint = get_default_blueprint()
    Object.assign(blueprint, TYPE_PRESETS.find(preset => preset.id === draft.type)!.diff)

    // Printing (booklet only applies to home printing)
    blueprint.service_id = draft.service_id!
    blueprint.size_id = draft.size_id!
    blueprint.booklet = draft.service_id === 'home' && draft.booklet
    blueprint.binding_type = draft.binding_type
    blueprint.ink_type = draft.ink_type
    blueprint.paper_type = draft.paper_type

    // Translations (the wizard's step validation guarantees 1-2, and 2 for bilingual)
    blueprint.bibles = [...draft.bibles] as [string, ...string[]]

    // Content: either one whole-book passage per selected book (canonical order regardless of
    // the order the user clicked them in), or the user's own passage list (their order, since
    // reordering it is the entire point of that mode), each showing its own heading

    // A passage's auto-derived heading text (matches the editor's own "Book or passage" ref
    // display), so a fresh design's passages show a sensible title out of the box
    const passage_reference = (ref_args:{book:string, start_chapter:number|null,
            start_verse:number|null, end_chapter:number|null, end_verse:number|null}):string => {
        return content.collection.reference_to_string(
            new PassageReference(ref_args), blueprint.bibles[0])
    }

    if (draft.type === 'picture_story'){
        if (draft.book_mode === 'passages'){
            // One passage per line, exactly like the regular passages mode, just wrapped as a
            // single unillustrated slide so an image can be added later per slide
            blueprint.content = draft.passages
                .filter((passage):passage is DraftPassage & {book:string} => passage.book !== null)
                .map(passage => {
                    const ref_args = {
                        book: passage.book,
                        start_chapter: passage.start_chapter,
                        start_verse: passage.start_verse,
                        end_chapter: passage.end_chapter,
                        end_verse: passage.end_verse,
                    }
                    return {
                        type: 'picture_story',
                        id: generate_token(),
                        title: passage_reference(ref_args),
                        title_subtitle: '',
                        title_icon: null,
                        slides: [{
                            id: generate_token(),
                            image: null,
                            mode: 'passage',
                            ...ref_args,
                            doc: {type: 'doc', content: [{type: 'paragraph'}]},
                        }],
                    } as ContentPictureStory
                })
        } else {
            // Predefined stories, in canonical order, each already illustrated (see story_to_slides)
            const stories = await fetch_stories()
            const selected = new Set(draft.stories)
            blueprint.content = stories
                .filter(story => selected.has(story.id))
                .sort(story_canonical_cmp)
                .map(story => ({
                    type: 'picture_story',
                    id: generate_token(),
                    title: story.heading,
                    title_subtitle: story_reference_label(story),
                    title_icon: null,
                    slides: story_to_slides(story),
                } as ContentPictureStory))
        }
    } else if (draft.book_mode === 'passages'){
        blueprint.content = draft.passages
            .filter((passage):passage is DraftPassage & {book:string} => passage.book !== null)
            .map(passage => {
                const ref_args = {
                    book: passage.book,
                    start_chapter: passage.start_chapter,
                    start_verse: passage.start_verse,
                    end_chapter: passage.end_chapter,
                    end_verse: passage.end_verse,
                }
                return {
                    type: 'passage',
                    id: generate_token(),
                    ...ref_args,
                    title: passage_reference(ref_args),
                    title_subtitle: '',
                    title_icon: null,
                } as ContentPassage
            })
    } else {
        const selected = new Set(draft.books)
        const canonical = content.collection
            .get_books(content.collection.get_preferred_resource().id, {whole: true})
            .map(book => book.id)
            .filter(id => selected.has(id))
        blueprint.content = canonical.map(book => {
            const ref_args = {
                book, start_chapter: null, start_verse: null, end_chapter: null, end_verse: null,
            }
            return {
                type: 'passage',
                id: generate_token(),
                ...ref_args,
                title: passage_reference(ref_args),
                title_subtitle: '',
                title_icon: null,
            } as ContentPassage
        })
    }
    blueprint.content.push({
        type: 'custom',
        id: generate_token(),
        name: "Copyright",
        doc: {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: 'AUTO-COPYRIGHT'}]},
        ]},
        position: 'bottom',
    })

    // Cover: either a seeded preset the user refines later in the cover widget, or the
    // minimal-ink choice (no cover at all, a title page as the first page instead)
    if (draft.cover === 'minimal'){
        blueprint.cover = null
        blueprint.content.unshift(make_wizard_title_item(blueprint))
    } else {
        blueprint.cover = seed_cover_preset(draft.cover as Exclude<NewDesignCover, 'minimal'>,
            blueprint)
    }

    return blueprint
}
