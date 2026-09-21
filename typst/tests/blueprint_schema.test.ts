
import {describe, it, expect} from 'vitest'

import {make_blueprint_schema, clean_content_items} from '../src/blueprint_schema.js'

import {make_blueprint} from './fixtures.js'

import type {ContentItem} from '../src/types.js'


// Parse untrusted input against a fresh set of defaults, as every caller must (catch values are
// referenced rather than cloned, so a shared defaults object could leak mutations between parses)
function clean(input:unknown){
    return make_blueprint_schema(make_blueprint()).parse(input)
}


// A valid item of each type, as a starting point for mutation
const VALID:Record<string, ContentItem> = {
    title: {type: 'title', id: 't1', title: 'Hi', title_subtitle: 'Sub', title_icon: null},
    passage: {type: 'passage', id: 'p1', book: 'gen', start_chapter: 1, start_verse: null,
        end_chapter: 3, end_verse: null, title: null, title_subtitle: '', title_icon: null,
        image: null},
    custom: {type: 'custom', id: 'c1', name: 'Notes', doc: {type: 'doc', content: []},
        position: 'bottom'},
    picture_story: {type: 'picture_story', id: 's1', title: null, title_subtitle: '',
        title_icon: null, slides: []},
}


describe('clean_content_items', () => {

    it('keeps every valid item', () => {
        const items = Object.values(VALID)
        expect(clean_content_items(items)).toHaveLength(items.length)
    })

    it('drops an item with no recognised type', () => {
        expect(clean_content_items([{type: 'nonsense', id: 'x'}])).toEqual([])
    })

    it('drops an item with no id', () => {
        expect(clean_content_items([{...VALID['title'], id: ''}])).toEqual([])
    })

    it('drops non-object junk', () => {
        expect(clean_content_items([null, 42, 'str', [], undefined])).toEqual([])
    })

    it('keeps the valid items either side of an invalid one', () => {
        const items = [VALID['title'], {type: 'nonsense'}, VALID['custom']]
        expect(clean_content_items(items).map(i => i.id)).toEqual(['t1', 'c1'])
    })

    // Duplicate ids would collide in the Firestore content_items map, silently losing one
    it('keeps only the first item of a duplicated id', () => {
        const first = {...VALID['title'], title: 'First'} as ContentItem
        const second = {...VALID['title'], title: 'Second'} as ContentItem
        const cleaned = clean_content_items([first, second])
        expect(cleaned).toHaveLength(1)
        expect((cleaned[0] as {title:string}).title).toBe('First')
    })

    it('deduplicates across differing item types sharing an id', () => {
        const cleaned = clean_content_items(
            [VALID['title'], {...VALID['custom'], id: 't1'}])
        expect(cleaned).toHaveLength(1)
        expect(cleaned[0]!.type).toBe('title')
    })

    describe('per-field degradation', () => {

        // A passage's heading is decoration around a reference — a type mismatch on it must
        // never take book/chapters/verses down with it

        it('keeps a passage whose title is the wrong type, defaulting to auto', () => {
            const cleaned = clean_content_items([{...VALID['passage'], title: 42}])
            expect(cleaned).toHaveLength(1)
            expect((cleaned[0] as {title:string|null}).title).toBe(null)
            expect((cleaned[0] as {book:string}).book).toBe('gen')
        })

        it('keeps a passage whose subtitle and icon are the wrong type', () => {
            const cleaned = clean_content_items(
                [{...VALID['passage'], title_subtitle: [], title_icon: 7}])
            expect(cleaned).toHaveLength(1)
            expect((cleaned[0] as {title_subtitle:string}).title_subtitle).toBe('')
            expect((cleaned[0] as {title_icon:string|null}).title_icon).toBe(null)
        })

        it('drops a passage with no book — there is no sensible default reference', () => {
            expect(clean_content_items([{...VALID['passage'], book: ''}])).toEqual([])
        })

        it('drops a passage whose chapter numbers are not numbers', () => {
            // Unlike the heading fields these carry no .catch(), because a wrong range would
            // silently render different scripture than the author chose
            expect(clean_content_items([{...VALID['passage'], start_chapter: '1'}])).toEqual([])
        })

        it('degrades a malformed passage image to no image', () => {
            const cleaned = clean_content_items([{...VALID['passage'], image: 'not-an-object'}])
            expect(cleaned).toHaveLength(1)
            expect((cleaned[0] as {image:unknown}).image).toBe(null)
        })

        it('degrades a malformed image original to null, keeping the image', () => {
            const cleaned = clean_content_items([{...VALID['passage'],
                image: {source: 'upload', url: null, path: 'design_assets/d/h.png', hash: 'h',
                    original: 'junk'}}])
            const image = (cleaned[0] as {image:{path:string, original:unknown}}).image
            expect(image.path).toBe('design_assets/d/h.png')
            expect(image.original).toBe(null)
        })

        it('degrades an unknown image source to url', () => {
            const cleaned = clean_content_items([{...VALID['passage'],
                image: {source: 'ftp', url: null, path: null, hash: null, original: null}}])
            expect((cleaned[0] as {image:{source:string}}).image.source).toBe('url')
        })

        it('degrades a malformed slides array to empty rather than dropping the story', () => {
            const cleaned = clean_content_items([{...VALID['picture_story'], slides: 'nope'}])
            expect(cleaned).toHaveLength(1)
            expect((cleaned[0] as {slides:unknown[]}).slides).toEqual([])
        })

        it('degrades a slide\'s bad mode and doc to sensible blanks', () => {
            const cleaned = clean_content_items([{...VALID['picture_story'],
                slides: [{id: 'sl1', image: null, mode: 'sideways', book: 'gen',
                    start_chapter: null, start_verse: null, end_chapter: null, end_verse: null,
                    doc: 'not a doc'}]}])
            const slide = (cleaned[0] as {slides:{mode:string, doc:unknown}[]}).slides[0]!
            expect(slide.mode).toBe('passage')
            expect(slide.doc).toEqual({type: 'doc', content: []})
        })

        it('drops a slide with no id', () => {
            const cleaned = clean_content_items([{...VALID['picture_story'],
                slides: [{id: '', image: null, mode: 'text', book: '', start_chapter: null,
                    start_verse: null, end_chapter: null, end_verse: null,
                    doc: {type: 'doc', content: []}}]}])
            // A bad slide fails the array, which .catch()es to empty — the story survives
            expect(cleaned).toHaveLength(1)
            expect((cleaned[0] as {slides:unknown[]}).slides).toEqual([])
        })

        it('drops a custom page with a non-object doc (no default text to fall back on)', () => {
            expect(clean_content_items([{...VALID['custom'], doc: 'plain string'}])).toEqual([])
        })

        it('drops a custom page with an unknown position', () => {
            expect(clean_content_items([{...VALID['custom'], position: 'sideways'}])).toEqual([])
        })
    })
})


describe('make_blueprint_schema', () => {

    it('accepts a valid blueprint unchanged', () => {
        const original = make_blueprint()
        expect(clean(original)).toEqual(original)
    })

    it('falls back wholesale when the input is not an object', () => {
        const defaults = make_blueprint()
        for (const junk of [null, undefined, 'string', 42, []]){
            expect(clean(junk)).toEqual(defaults)
        }
    })

    it('falls back per field for a wrong-typed scalar, keeping the rest', () => {
        const cleaned = clean(make_blueprint({font_size: 'huge' as unknown as number,
            hyphenate: false}))
        expect(cleaned.font_size).toBe(10)
        expect(cleaned.hyphenate).toBe(false)
    })

    it('falls back for an enum value outside its set', () => {
        expect(clean(make_blueprint(
            {show_chapters_style: 'sparkles' as unknown as 'divider'})).show_chapters_style)
            .toBe('divider')
        expect(clean(make_blueprint(
            {margin_unit: 'furlong' as unknown as 'mm'})).margin_unit).toBe('mm')
        expect(clean(make_blueprint(
            {image_style: 'evil' as unknown as 'padded'})).image_style).toBe('padded')
    })

    it('strips fields the current Blueprint no longer declares', () => {
        const cleaned = clean({...make_blueprint(), retired_option: true, page_count: 200})
        expect('retired_option' in cleaned).toBe(false)
        expect('page_count' in cleaned).toBe(false)
    })

    it('supplies a default for a field an older doc never had', () => {
        const {column_gap: _dropped, ...older} = make_blueprint()
        expect(clean(older).column_gap).toBe(6)
    })

    it('requires at least one bible, falling back when the tuple is empty', () => {
        expect(clean(make_blueprint({bibles: [] as unknown as [string]})).bibles)
            .toEqual(['eng_bsb'])
    })

    it('keeps a second bible', () => {
        expect(clean(make_blueprint({bibles: ['eng_bsb', 'spa_rvr']})).bibles)
            .toEqual(['eng_bsb', 'spa_rvr'])
    })

    it('falls back when a bible entry is not a string', () => {
        expect(clean(make_blueprint({bibles: [42] as unknown as [string]})).bibles)
            .toEqual(['eng_bsb'])
    })

    it('drops invalid content items while keeping valid ones', () => {
        const cleaned = clean(make_blueprint(
            {content: [VALID['title']!, {type: 'nope'} as unknown as ContentItem]}))
        expect(cleaned.content.map(i => i.id)).toEqual(['t1'])
    })

    it('falls back to the default content when content is not an array', () => {
        const cleaned = clean(make_blueprint({content: 'nope' as unknown as ContentItem[]}))
        expect(cleaned.content).toEqual([])
    })

    it('keeps nullable style fields as null', () => {
        const cleaned = clean(make_blueprint({text_color: null, justify: null, columns: null}))
        expect(cleaned.text_color).toBe(null)
        expect(cleaned.justify).toBe(null)
        expect(cleaned.columns).toBe(null)
    })

    it('does not mutate the defaults object it was built from', () => {
        const defaults = make_blueprint()
        const schema = make_blueprint_schema(defaults)
        const parsed = schema.parse({content: [VALID['title']]})
        parsed.content.push(VALID['custom']!)
        expect(defaults.content).toEqual([])
    })
})
