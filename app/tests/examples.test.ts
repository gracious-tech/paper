
// Building an example design (examples.ts): which translations it's read in and in what order
// (the user's own leading, or an original-language edition's), its books in canonical order,
// home printing folding a booklet on the user's likely paper, its optional message page, and the
// cover carrying the example's own title. The cover preset and design creation are stand-ins

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {content, reset_content, set_translations} from './stubs/content'


// The cover preset and the design it's saved as
const mocks = vi.hoisted(() => ({
    create_design: vi.fn(async () => 'design_new'),
}))

vi.mock('@/services/cover', () => ({
    seed_cover_preset: vi.fn((preset:string) => ({preset, title_custom: false, form: {},
        bg_image: null})),
}))
vi.mock('@/services/designs', () => ({create_design: mocks.create_design}))


import {build_example_blueprint, create_example_design} from '@/services/examples'
import {translate} from '@/services/i18n'

import type {ContentCustom} from '@/services/types'
import type {ExampleDesign} from '@/services/example_designs'


// An example with the given extras over a plain home-printed one
function example(overrides:Partial<ExampleDesign> = {}):ExampleDesign{
    return {id: 'test', pages: 10, books: ['jhn', 'gen'], cover: 'pattern', diff: {},
        ...overrides}
}


// A message page, as create_example_design makes one
const MESSAGE = {type: 'custom', id: 'm1', name: 'Message', doc: {type: 'doc', content: []},
    position: 'middle'} as ContentCustom


beforeEach(() => {
    vi.clearAllMocks()
    // Nothing remembered (the paper size guess reads it), since these tests run in node
    vi.stubGlobal('localStorage', {getItem: () => null, setItem: () => undefined})
    reset_content()
    set_translations(['eng_bsb', 'grc_sr', 'cmn_bibs'])
    // The Bible's books in canonical order, whatever order an example lists them in
    Object.assign(content.collection, {get_books: () =>
        ['gen', 'exo', 'mrk', 'jhn', '1jn'].map(id => ({id}))})
})


afterEach(() => {
    vi.unstubAllGlobals()
})


describe('build_example_blueprint', () => {

    it('lays its books out in canonical order, as whole books', () => {
        const blueprint = build_example_blueprint(example(), 'T', 'S', null, 'eng_bsb', 'en')
        expect(blueprint.content.map(item => item.type === 'passage'
            && [item.book, item.start_chapter])).toEqual([['gen', null], ['jhn', null]])
    })

    it('leads with the user\'s translation, then the example\'s own, never twice', () => {
        const blueprint = build_example_blueprint(example({trans: ['cmn_bibs', 'eng_bsb']}),
            'T', 'S', null, 'eng_bsb', 'en')
        expect(blueprint.bibles).toEqual(['eng_bsb', 'cmn_bibs'])
    })

    it('leads with the example\'s translation for an original-language edition', () => {
        const blueprint = build_example_blueprint(example({trans: ['grc_sr'], trans_first: true}),
            'T', 'S', null, 'eng_bsb', 'en')
        expect(blueprint.bibles).toEqual(['grc_sr', 'eng_bsb'])
    })

    it('folds a home-printed example into a booklet, and nothing printed elsewhere', () => {
        expect(build_example_blueprint(example(), 'T', 'S', null, 'eng_bsb', 'en').booklet)
            .toBe(true)
        const pro = build_example_blueprint(example({diff: {service_id: 'lulu', size_id: 'a5'}}),
            'T', 'S', null, 'eng_bsb', 'en')
        expect(pro.booklet).toBe(false)
        // A professional trim the example names is kept as is
        expect(pro.size_id).toBe('a5')
    })

    it('opens with the message page when it has one', () => {
        const blueprint = build_example_blueprint(example({message: true}), 'T', 'S', MESSAGE,
            'eng_bsb', 'en')
        expect(blueprint.content[0]).toBe(MESSAGE)
        expect(blueprint.content).toHaveLength(3)
    })

    it('titles its cover with the example\'s own words, the design itself left unnamed', () => {
        const blueprint = build_example_blueprint(example({cover_bg_image: 'lion.jpg'}),
            'The Gospel', 'of John', null, 'eng_bsb', 'en')
        expect(blueprint.cover!.title_custom).toBe(true)
        expect(blueprint.cover!.form['subtitle']).toBe('of John')
        expect(blueprint.cover!.bg_image).toEqual({kind: 'builtin', id: 'lion.jpg'})
        expect(blueprint.name).toBe('')
    })

})


describe('create_example_design', () => {

    it('creates the example read in a translation in the app\'s language', async () => {
        await expect(create_example_design('journal', translate)).resolves.toBe('design_new')
        const [blueprint] = mocks.create_design.mock.calls[0] as unknown as [
            {bibles:string[], content:{type:string}[]}]
        expect(blueprint.bibles).toEqual(['eng_bsb'])
        // The journal is a gift edition: it opens with a message page to personalise
        expect(blueprint.content[0]!.type).toBe('custom')
    })

})
