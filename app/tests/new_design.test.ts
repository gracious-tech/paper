
// The new-design wizard's data (new_design.ts): a stored draft read back from Firestore
// (validated, with withdrawn translations swapped as the blueprint's are), and the parts of
// building a blueprint from a draft the journeys don't reach: free-text passages, a picture
// story of passages, and the minimal-ink pages that stand in for a cover

import {describe, it, expect, beforeEach, vi} from 'vitest'

import {reset_content, set_translations} from './stubs/content'


// The cover preset, the predefined stories and uploaded fonts are stand-ins (they render, fetch
// or reach Firebase)
vi.mock('@/services/cover', () => ({
    seed_cover_preset: vi.fn((preset:string) => ({preset, title_custom: false, form: {}})),
    render_wizard_cover_preview: vi.fn(),
}))
vi.mock('@/services/typst', () => ({typst_generator: {value: null}}))
vi.mock('@/services/custom_fonts', () => ({get_custom_font_styles: () => []}))
vi.mock('@/services/stories', () => ({
    fetch_stories: vi.fn(async () => []),
    story_to_slides: vi.fn(() => []),
    story_reference_label: vi.fn(() => ''),
    story_canonical_cmp: vi.fn(() => 0),
}))


import {
    build_new_blueprint, clean_wizard_draft, get_default_draft, read_wizard_state,
    type_preset_image, wizard_auto_title,
} from '@/services/new_design'

import type {DraftPassage, NewDesignDraft} from '@/services/new_design'
import type {ContentCustom, ContentPictureStory} from '@/services/types'


// A free-text passage line, parsed (or not, without a book)
function line(id:string, book:string|null, start_chapter:number|null = 1):DraftPassage{
    return {id, text: `${book} ${start_chapter}`, book, start_chapter, start_verse: null,
        end_chapter: start_chapter, end_verse: null}
}


// A draft with the given answers over the blank default
function draft(overrides:Partial<NewDesignDraft> = {}):NewDesignDraft{
    return {...get_default_draft(), bibles: ['eng_bsb'], service_id: 'home', size_id: 'a4',
        ...overrides}
}


beforeEach(() => {
    reset_content()
    set_translations(['eng_bsb', 'spa_rvr'])
})


describe('clean_wizard_draft', () => {

    it('is null for a design the wizard never made', () => {
        expect(clean_wizard_draft(null)).toBe(null)
        expect(clean_wizard_draft(undefined)).toBe(null)
    })

    it('falls back to a blank draft for something that isn\'t one at all', () => {
        expect(clean_wizard_draft('not a draft')).toEqual(get_default_draft())
        expect(clean_wizard_draft(42)).toEqual(get_default_draft())
    })

    it('degrades a bad field to "not chosen yet", keeping the rest', () => {
        const cleaned = clean_wizard_draft({...draft({title: 'Mine'}), type: 'not_a_type',
            passages: [line('l1', 'jhn'), {id: 'l2', text: 7, book: 'rom'}]})
        expect(cleaned!.type).toBe(null)
        expect(cleaned!.title).toBe('Mine')
        // A single bad field in a line blanks that field, not the line
        expect(cleaned!.passages.map(passage => [passage.id, passage.text, passage.book]))
            .toEqual([['l1', 'jhn 1', 'jhn'], ['l2', '', 'rom']])
    })

    it('swaps a withdrawn translation for another in its language', () => {
        expect(clean_wizard_draft(draft({bibles: ['spa_old', 'eng_bsb']}))!.bibles)
            .toEqual(['spa_rvr', 'eng_bsb'])
    })

    it('gives a chosen list emptied by withdrawals the default translation', () => {
        expect(clean_wizard_draft(draft({bibles: ['xyz_gone']}))!.bibles).toEqual(['eng_bsb'])
    })

    it('leaves an empty list empty, since that means the step isn\'t reached yet', () => {
        expect(clean_wizard_draft(draft({bibles: []}))!.bibles).toEqual([])
    })

})


describe('read_wizard_state', () => {

    it('keeps the simplified editor only for a design that has a draft to show', () => {
        expect(read_wizard_state({wizard_draft: draft(), simple_mode: true}).simple_mode).toBe(true)
        expect(read_wizard_state({wizard_draft: null, simple_mode: true}))
            .toEqual({wizard_draft: null, simple_mode: false})
        expect(read_wizard_state({wizard_draft: draft()}).simple_mode).toBe(false)
    })

})


describe('type_preset_image', () => {

    it('has no picture for a type without one', () => {
        expect(type_preset_image(null, 'en')).toBeUndefined()
    })

})


describe('wizard_auto_title', () => {

    it('is blank before any passage is chosen', () => {
        expect(wizard_auto_title(draft({book_mode: 'passages', passages: []}))).toBe('')
    })

    it('names the first passage in the first translation', () => {
        // The content stub formats references as "<bible>:<book> <chapters>"
        expect(wizard_auto_title(draft({book_mode: 'passages', passages: [line('l1', 'jhn', 3)]})))
            .toBe('eng_bsb:jhn 3')
    })

})


describe('build_new_blueprint', () => {

    it('keeps free-text passages in the user\'s order, skipping lines that didn\'t parse', async () => {
        const blueprint = await build_new_blueprint(draft({book_mode: 'passages', passages: [
            line('l1', 'rom', 8), line('l2', null), line('l3', 'gen', 1)]}))
        expect(blueprint.content.map(item => item.type === 'passage' && item.book))
            .toEqual(['rom', 'gen'])
        // Headings are left to the render pipeline (null = auto)
        expect(blueprint.content.every(item => item.type === 'passage' && item.title === null))
            .toBe(true)
    })

    it('wraps each passage of a picture story as one unillustrated slide', async () => {
        const blueprint = await build_new_blueprint(draft({type: 'picture_story',
            book_mode: 'passages', passages: [line('l1', 'mrk', 4), line('l2', null)]}))
        const stories = blueprint.content as ContentPictureStory[]
        expect(stories).toHaveLength(1)
        expect(stories[0]!.type).toBe('picture_story')
        expect(stories[0]!.slides).toEqual([expect.objectContaining({image: null, mode: 'passage',
            book: 'mrk', start_chapter: 4, end_chapter: 4})])
    })

    it('opens and closes a minimal-ink design with title and copyright pages', async () => {
        const blueprint = await build_new_blueprint(draft({cover: 'minimal', title: ' Psalms ',
            book_mode: 'passages', passages: [line('l1', 'psa', 23)]}))
        expect(blueprint.cover).toBe(null)
        expect(blueprint.content.map(item => item.type)).toEqual(['title', 'passage', 'custom'])
        const copyright = blueprint.content[2] as ContentCustom
        expect(JSON.stringify(copyright.doc)).toContain('AUTO-COPYRIGHT')
        // Pinned to the last page, the back of the folded booklet
        expect(blueprint.last_item_at_end).toBe(true)
        // The title prints on the title page; the design's own name stays blank
        expect(JSON.stringify(blueprint.content[0])).toContain('Psalms')
        expect(blueprint.name).toBe('')
    })

    it('marks a cover\'s title as the user\'s own only when the wizard was given one', async () => {
        const passages = {book_mode: 'passages' as const, passages: [line('l1', 'jhn')]}
        const titled = await build_new_blueprint(draft({...passages, cover: 'photo',
            title: 'My Gospel'}))
        expect(titled.cover!.title_custom).toBe(true)
        const untitled = await build_new_blueprint(draft({...passages, cover: 'photo', title: '  '}))
        expect(untitled.cover!.title_custom).toBe(false)
    })

})
