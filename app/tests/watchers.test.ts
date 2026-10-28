// The app's standing watchers (watchers.ts): each selected translation's book list is loaded,
// each passage's book is preloaded in the format it will compile from (Typst for passages across
// every translation, plain text for picture stories in the primary one only) and marked ready
// once it arrives, the design's name follows to the cover, the font pickers' example text tracks
// the content, and a simple design's binding follows its page estimate. The content service,
// cover and binding advice are stand-ins

import {describe, it, expect, beforeEach, vi} from 'vitest'
import {nextTick, reactive} from 'vue'

import {blue, set_blue, estimated_pages} from './stubs/state'
import {make_blueprint, make_passage, make_title} from './helpers/blueprint'

import type {ContentPictureStory} from '@/services/types'


// The content service: which books were fetched in which format, and what each resolves to
const mocks = vi.hoisted(() => ({
    content: {loaded: {} as Record<string, boolean>,
        example_text: {title: '', heading: '', verse: ''},
        // What make_blueprint()'s default translation is asked of
        translations: {} as Record<string, unknown>,
        collection: {get_preferred_resource: () => ({id: 'eng_bsb'})}},
    fetch_book: vi.fn(async (_bible:string, _book:string):Promise<object|null> => ({})),
    fetch_book_txt: vi.fn(async (_bible:string, _book:string):Promise<object|null> => ({})),
    ensure_books: vi.fn(async (_bible:string) => undefined),
    examples: vi.fn(async (..._args:unknown[]) => ({heading: 'In the beginning',
        verse: 'God created'})),
    apply_name_to_cover: vi.fn(),
    auto_binding: vi.fn((..._args:unknown[]) => 'coil'),
    wizard: {simple_mode: false},
}))
vi.mock('@/services/content', () => ({
    content: mocks.content,
    bible_content: {fetch_book: mocks.fetch_book, fetch_book_txt: mocks.fetch_book_txt},
    resolve_passage_examples: mocks.examples,
    ensure_bible_books_loaded: mocks.ensure_books,
}))
vi.mock('@/services/designs', async () => {
    const {reactive} = await import('vue')
    mocks.wizard = reactive({simple_mode: false})
    return {design_wizard: mocks.wizard}
})
vi.mock('@/services/cover', () => ({apply_name_to_cover: mocks.apply_name_to_cover}))
vi.mock('@/services/binding_advice', () => ({auto_binding: mocks.auto_binding}))


import {start_watchers} from '@/services/watchers'


// Let watchers and the promises they start settle
async function settle():Promise<void>{
    for (let i = 0; i < 5; i++){
        await nextTick()
        await Promise.resolve()
    }
}


// A picture story whose slides come from the given books ('' for a free-text slide)
function make_story(books:string[]):ContentPictureStory{
    return {
        type: 'picture_story', id: 's1', title: 'Story', title_subtitle: '', title_icon: null,
        slides: books.map((book, i) => ({id: `sl${i}`, image: null,
            mode: book ? 'passage' : 'text', book, start_chapter: 1, start_verse: null,
            end_chapter: 1, end_verse: null, doc: {type: 'doc', content: []}})),
    } as unknown as ContentPictureStory
}


// The [bible, book] pairs a fetch mock was called with
function fetched(mock:typeof mocks.fetch_book):string[]{
    return mock.mock.calls.map(([bible, book]) => `${bible}_${book}`)
}


// The watchers are registered once, against the shared `blue`; each test then changes it
let started = false


beforeEach(async () => {
    mocks.content.loaded = reactive({})
    for (const mock of [mocks.fetch_book, mocks.fetch_book_txt, mocks.ensure_books,
            mocks.examples, mocks.apply_name_to_cover, mocks.auto_binding]){
        mock.mockClear()
    }
    mocks.wizard.simple_mode = false
    estimated_pages.value = null
    set_blue(make_blueprint({bibles: ['eng_bsb'], content: []}))
    if (!started){
        start_watchers()
        started = true
    }
    await settle()
    for (const mock of [mocks.fetch_book, mocks.fetch_book_txt, mocks.ensure_books,
            mocks.examples, mocks.apply_name_to_cover, mocks.auto_binding]){
        mock.mockClear()
    }
})


describe('preloading', () => {

    // Book names and words-of-Jesus support, for every translation chosen
    it('loads each selected translation\'s book list', async () => {
        blue.bibles = ['eng_bsb', 'spa_rv']
        await settle()
        expect(mocks.ensure_books.mock.calls.map(([bible]) => bible)).toEqual(['eng_bsb', 'spa_rv'])
    })

    // Passages compile from Typst in every translation; each distinct book is fetched once and
    // marked ready when it arrives
    it('fetches each passage\'s book in every translation, and marks it ready', async () => {
        blue.bibles = ['eng_bsb', 'spa_rv']
        blue.content = [make_passage('a', {book: 'gen'}), make_passage('b', {book: 'gen'}),
            make_passage('c', {book: 'exo'})]
        await settle()
        expect(fetched(mocks.fetch_book).sort()).toEqual(
            ['eng_bsb_exo', 'eng_bsb_gen', 'spa_rv_exo', 'spa_rv_gen'])
        expect(mocks.content.loaded).toMatchObject({eng_bsb_gen: true, spa_rv_exo: true})
    })

    // A book already loaded isn't fetched again, and one a translation lacks isn't marked ready
    it('skips books already loaded and never marks a missing one ready', async () => {
        mocks.content.loaded['eng_bsb_gen'] = true
        mocks.fetch_book.mockResolvedValueOnce(null)
        blue.content = [make_passage('a', {book: 'gen'}), make_passage('b', {book: 'jud'})]
        await settle()
        expect(fetched(mocks.fetch_book)).toEqual(['eng_bsb_jud'])
        expect(mocks.content.loaded['eng_bsb_jud']).toBeUndefined()
    })

    // Picture stories render plain text from the primary translation only, under keys of their
    // own so they never clash with the same book's Typst readiness
    it('fetches a story\'s books as plain text, primary translation only', async () => {
        blue.bibles = ['eng_bsb', 'spa_rv']
        mocks.fetch_book_txt.mockImplementation(async (_bible, book) => book === 'rut' ? null : {})
        blue.content = [make_story(['jon', '', 'jon', 'rut'])]
        await settle()
        expect(fetched(mocks.fetch_book_txt)).toEqual(['eng_bsb_jon', 'eng_bsb_rut'])
        expect(mocks.fetch_book).not.toHaveBeenCalled()
        expect(mocks.content.loaded).toEqual({'eng_bsb_jon~txt': true})

        // Already loaded, it isn't fetched again
        mocks.fetch_book_txt.mockClear()
        blue.content = [make_story(['jon'])]
        await settle()
        expect(mocks.fetch_book_txt).not.toHaveBeenCalled()
        mocks.fetch_book_txt.mockImplementation(async () => ({}))
    })

})


describe('following the design', () => {

    // Every way the name changes reaches the cover through one place
    it('carries a rename to the cover', async () => {
        blue.name = 'Psalms for Mum'
        await settle()
        expect(mocks.apply_name_to_cover).toHaveBeenCalledWith(blue)
    })

    // The font pickers preview with the design's own title, heading and verse
    it('takes the font pickers\' example text from the content', async () => {
        blue.content = [make_title('t', '  The Gospel  '), make_passage('p', {book: 'jhn'})]
        await settle()
        expect(mocks.content.example_text).toEqual({title: 'The Gospel',
            heading: 'In the beginning', verse: 'God created'})
        expect(mocks.examples).toHaveBeenLastCalledWith(blue.content[1], ['eng_bsb'])

        // With no passage there's nothing to quote
        blue.content = []
        await settle()
        expect(mocks.content.example_text).toEqual({title: '', heading: '', verse: ''})
    })

    // A simple design's binding follows its length, once there's an estimate to go on
    it('re-derives a simple design\'s binding from each page estimate', async () => {
        blue.binding_type = 'paperback'
        mocks.wizard.simple_mode = true
        await settle()
        // No estimate yet: a full-length guess would flip a short design's binding on every load
        expect(mocks.auto_binding).not.toHaveBeenCalled()

        estimated_pages.value = 40
        await settle()
        expect(mocks.auto_binding).toHaveBeenLastCalledWith(blue, 40)
        expect(blue.binding_type).toBe('coil')
    })

    // The full editor's binding is the user's own choice
    it('leaves the full editor\'s binding alone', async () => {
        blue.binding_type = 'paperback'
        estimated_pages.value = 40
        await settle()
        expect(mocks.auto_binding).not.toHaveBeenCalled()
        expect(blue.binding_type).toBe('paperback')
    })

})
