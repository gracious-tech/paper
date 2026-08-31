
// New-design wizard support: the per-step draft of user selections, the design-type presets,
// and the assembly of a final Blueprint from a completed draft (only done once, at finish)

import {PassageReference} from '@gracious.tech/fetch-client'

import {content} from '@/services/content'
import {get_default_blueprint, get_passages} from '@/services/blueprints'
import {seed_cover_preset} from '@/services/cover'
import {generate_token} from '@/services/utils'
import {fetch_stories, story_to_slides, story_reference_label, story_canonical_cmp}
    from '@/services/stories'
import img_type_regular from '@/assets/images/design_types/type_standard.avif'
import img_type_reading from '@/assets/images/design_types/type_reading.avif'
import img_type_notes from '@/assets/images/design_types/type_notes.avif'
import img_type_study from '@/assets/images/design_types/type_study.avif'
import img_type_bilingual from '@/assets/images/design_types/type_bilingual.avif'

import type {Blueprint, ContentPassage, ContentPictureStory} from '@/services/types'


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
    title:string  // Cover/design title; blank falls back to the first passage's reference
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
        title: '',
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


// Step ids of the wizard, in order — shared between DialogNewDesign.vue's stepper and the
// single-step sidebar editor (EditorWizardStep.vue) so both drive from one source of truth
export const WIZARD_STEPS = ['type', 'books', 'bibles', 'print', 'cover'] as const
export type WizardStep = typeof WIZARD_STEPS[number]


// Whether a given step's choices in the draft are complete enough to move on/save — hoisted out
// of DialogNewDesign.vue so EditorWizardStep.vue's single-step Save button can reuse the exact
// same check
export function is_wizard_step_valid(draft:NewDesignDraft, step:WizardStep):boolean{
    if (step === 'type'){
        return draft.type !== null
    }
    if (step === 'books'){
        if (draft.book_mode === 'passages'){
            return draft.passages.some(passage => passage.book !== null)
        }
        return draft.type === 'picture_story' ? draft.stories.length >= 1 : draft.books.length >= 1
    }
    if (step === 'bibles'){
        const bibles = draft.bibles.filter(id => id)
        const distinct = new Set(bibles).size === bibles.length
        const two_if_bilingual = draft.type !== 'bilingual' || bibles.length === 2
        return bibles.length >= 1 && distinct && two_if_bilingual
    }
    if (step === 'print'){
        return draft.service_id !== null && draft.size_id !== null
    }
    return draft.cover !== null
}


// Whether every step of the draft is complete (required before a create/edit-mode "type" save,
// since the stepper allows jumping between steps out of order)
export function all_wizard_steps_valid(draft:NewDesignDraft):boolean{
    return WIZARD_STEPS.every(step => is_wizard_step_valid(draft, step))
}


// Display label/subtitle per design type — hoisted out of NewDesignType.vue so the simple-mode
// summary row can show the same text as the wizard step itself
export function wizard_type_label(id:NewDesignType, t:(key:string) => string):
        {label:string, subtitle:string}{
    const labels:Record<NewDesignType, {label:string, subtitle:string}> = {
        regular: {
            label: t("Regular Bible"),
            subtitle: t("How most bibles look, with verse numbers and headings"),
        },
        reading: {
            label: t("Reading Bible"),
            subtitle: t("No verse numbers, like a normal book"),
        },
        notes: {
            label: t("Notes Bible"),
            subtitle: t("Lots of space to write notes"),
        },
        study: {
            label: t("Study Bible"),
            subtitle: t("Extensive footnotes to guide readers"),
        },
        bilingual: {
            label: t("Bilingual Bible"),
            subtitle: t("Two translations side by side"),
        },
        picture_story: {
            label: t("Picture Story"),
            subtitle: t("Illustrated Bible stories, one image per page"),
        },
    }
    return labels[id]
}


// Display label per cover style — hoisted out of NewDesignCover.vue for the same reason as
// wizard_type_label() above
export function wizard_cover_label(id:NewDesignCover, t:(key:string) => string):string{
    const labels:Record<NewDesignCover, string> = {
        photo: t("Photo"),
        pattern: t("Pattern"),
        icon: t("Icon"),
        minimal: t("Minimal ink"),
    }
    return labels[id]
}


// A minimal-but-real Blueprint built straight from the wizard's draft, for the cover step's
// live preview cards to feed into seed_cover_preset()/cover_form_for_render() before a real
// Blueprint exists (that only happens at build_new_blueprint(), the wizard's last step). Only
// the print/translation fields plus a single representative content item are needed — those are
// the only fields the cover form-builder reads (title, bibles[0], service_id/size_id/binding_
// type/ink_type/paper_type). Picture-story stories aren't tied to a single book id, so content
// stays empty in that mode (the cover preset falls back to an untitled/unthemed preview)
export function wizard_preview_blueprint(draft:NewDesignDraft):Blueprint{
    const blueprint = get_default_blueprint()
    blueprint.service_id = draft.service_id ?? blueprint.service_id
    blueprint.size_id = draft.size_id ?? blueprint.size_id
    blueprint.binding_type = draft.binding_type
    blueprint.ink_type = draft.ink_type
    blueprint.paper_type = draft.paper_type
    blueprint.title = (draft.title ?? '').trim()
    if (draft.bibles.length){
        blueprint.bibles = [...draft.bibles] as [string, ...string[]]
    }

    let ref_args:{book:string, start_chapter:number|null, start_verse:number|null,
        end_chapter:number|null, end_verse:number|null}|null = null
    if (draft.book_mode === 'passages'){
        const passage = draft.passages.find(item => item.book !== null)
        if (passage){
            ref_args = {book: passage.book!, start_chapter: passage.start_chapter,
                start_verse: passage.start_verse, end_chapter: passage.end_chapter,
                end_verse: passage.end_verse}
        }
    } else if (draft.type !== 'picture_story'){
        const selected = new Set(draft.books)
        const canonical = content.collection
            .get_books(content.collection.get_preferred_resource().id, {whole: true})
            .map(book => book.id)
            .find(id => selected.has(id))
        if (canonical){
            ref_args = {book: canonical, start_chapter: null, start_verse: null,
                end_chapter: null, end_verse: null}
        }
    }
    if (ref_args){
        blueprint.content = [{type: 'passage', id: 'wizard-preview', ...ref_args,
            title: '', title_subtitle: '', title_icon: null} as ContentPassage]
    }
    return blueprint
}


// The title the cover falls back to when the wizard's title field is left blank: the first
// included passage's reference (e.g. "Titus"), the same fallback default_cover_preset() uses.
// Empty when there's no single representative passage (e.g. picture-story mode), in which case
// the field simply has no placeholder text
export function wizard_auto_title(draft:NewDesignDraft):string{
    const blueprint = wizard_preview_blueprint(draft)
    const passage = get_passages(blueprint)[0]
    if (!passage){
        return ''
    }
    return content.collection.reference_to_string(
        new PassageReference(passage), blueprint.bibles[0])
}


// Assemble the final Blueprint from a completed draft: defaults, then the type preset's diff,
// then each step's selections. Content becomes whole-book passages in canonical order (or the
// user's own passage list). No copyright page is added — the auto-copyright statement lives on
// the back of the cover. Async because the picture_story type looks up the predefined story
// list (already cached by the time the wizard reaches this step)
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

    // Title: the wizard's optional title field — blank means the design/cover falls back to the
    // first passage's reference (see design_name() and default_cover_preset())
    blueprint.title = (draft.title ?? '').trim()

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
    // Cover: a seeded preset the user refines later in the cover widget
    blueprint.cover = seed_cover_preset(draft.cover!, blueprint)

    return blueprint
}
