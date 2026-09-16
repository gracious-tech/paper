
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {BibleContent, resolve_declared_cjk_variant} from '../src/bible_content.js'

import type {BibleCollection, GetResourcesItem} from '@gracious.tech/fetch-client'
import type {Blueprint, ContentPassage, ContentPictureStory} from '../src/types.js'


// Minimal fake resource, overridden per test — only language/script/region matter here
function make_resource(overrides:Partial<GetResourcesItem> = {}):GetResourcesItem {
    return {
        id: 'fake', language: 'eng', script: undefined, region: undefined, direction: 'ltr',
        year: 2000, attribution: '', attribution_url: '', licenses: [], tags: [], name: '',
        name_abbrev: '', name_english: '', name_english_abbrev: '', name_local: '',
        name_local_abbrev: '', name_bilingual: '', name_bilingual_abbrev: '', ...overrides,
    }
}


// Track fetch_collection calls without any network (hoisted so the module mock can use it)
const {fetch_collection} = vi.hoisted(() => {
    return {fetch_collection: vi.fn(() => Promise.resolve({bibles: {fake: true}}))}
})

// Replace FetchClient with a stub that returns a fake collection; keep everything else real
vi.mock('@gracious.tech/fetch-client', async importOriginal => {
    const original = await importOriginal<typeof import('@gracious.tech/fetch-client')>()
    return {
        ...original,
        FetchClient: class {
            fetch_collection = fetch_collection
        },
    }
})


describe('BibleContent.init collection TTL', () => {

    beforeEach(() => {
        fetch_collection.mockClear()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('fetches the collection once and no-ops on re-init by default', async () => {
        const content = new BibleContent({endpoint: 'http://example.invalid/'})
        await content.init()
        await content.init()
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(1)
    })

    it('re-fetches once the TTL has lapsed', async () => {
        const content = new BibleContent({
            endpoint: 'http://example.invalid/',
            manifest_ttl_ms: 60 * 60 * 1000,
        })
        await content.init()
        // Still fresh — no refetch
        vi.advanceTimersByTime(30 * 60 * 1000)
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(1)
        // Stale — refetch
        vi.advanceTimersByTime(31 * 60 * 1000)
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(2)
        // Fresh again after the refetch
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(2)
    })

    it('never fetches when a collection was injected', async () => {
        const content = new BibleContent({
            collection: {fake: true} as unknown as BibleCollection,
            manifest_ttl_ms: 1,
        })
        vi.advanceTimersByTime(1000)
        await content.init()
        expect(fetch_collection).not.toHaveBeenCalled()
        expect(content.collection).toEqual({fake: true})
    })
})


describe('resolve_declared_cjk_variant', () => {

    it('returns undefined for an untagged resource, so callers fall back to text detection', () => {
        expect(resolve_declared_cjk_variant(undefined)).toBeUndefined()
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn'}))).toBeUndefined()
    })

    it('resolves Japanese/Korean from the language code alone, ignoring script/region', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'jpn'}))).toBe('JP')
        expect(resolve_declared_cjk_variant(make_resource({language: 'kor'}))).toBe('KR')
    })

    it('resolves Simplified Chinese from script alone', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn', script: 'Hans'})))
            .toBe('SC')
    })

    it('defaults Traditional Chinese to TC when no region is declared', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn', script: 'Hant'})))
            .toBe('TC')
    })

    it('resolves Traditional Chinese to HK when the region is declared', () => {
        expect(resolve_declared_cjk_variant(
            make_resource({language: 'cmn', script: 'Hant', region: 'HK'})))
            .toBe('HK')
    })
})


describe('title null/empty/string fallback resolution', () => {

    // A fake collection whose reference_to_string always returns a fixed sentinel, regardless
    // of the passage — the private resolvers under test only care whether/how they call it, not
    // what a real reference string looks like (that's PassageReference's own concern)
    const reference_to_string = vi.fn(() => 'AUTO_REF')
    const collection = {reference_to_string} as unknown as BibleCollection
    const content = new BibleContent({collection})
    const blue = {bibles: ['eng']} as Blueprint

    const make_passage = (overrides:Partial<ContentPassage> = {}):ContentPassage => ({
        type: 'passage', id: 'p1', book: 'gen', start_chapter: 1, start_verse: null,
        end_chapter: 1, end_verse: null, title: null, title_subtitle: '', title_icon: null,
        image: null, ...overrides,
    })

    const make_story = (overrides:Partial<ContentPictureStory> = {}):ContentPictureStory => ({
        type: 'picture_story', id: 's1', title: null, title_subtitle: '', title_icon: null,
        slides: [], ...overrides,
    })

    beforeEach(() => {
        reference_to_string.mockClear()
    })

    it('passage: a null title falls back to the reference', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(blue, make_passage())
        expect(title).toBe('AUTO_REF')
        expect(reference_to_string).toHaveBeenCalledTimes(1)
    })

    it("passage: an explicit '' title stays suppressed, without calling reference_to_string", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(blue, make_passage({title: ''}))
        expect(title).toBe('')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('passage: a literal custom title passes through unchanged', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(
            blue, make_passage({title: 'My Title'}))
        expect(title).toBe('My Title')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('picture story: a null title falls back to a reference spanning its passage slides', () => {
        const story = make_story({slides: [
            {id: 'sl1', image: null, mode: 'passage', book: 'gen', start_chapter: 1,
                start_verse: null, end_chapter: 1, end_verse: null, doc: {type: 'doc', content: []}},
            {id: 'sl2', image: null, mode: 'text', book: '', start_chapter: null,
                start_verse: null, end_chapter: null, end_verse: null, doc: {type: 'doc', content: []}},
        ]})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('AUTO_REF')
        expect(reference_to_string).toHaveBeenCalledTimes(1)
    })

    it('picture story: a null title with no passage-mode slides stays suppressed', () => {
        const story = make_story({slides: [
            {id: 'sl1', image: null, mode: 'text', book: '', start_chapter: null,
                start_verse: null, end_chapter: null, end_verse: null, doc: {type: 'doc', content: []}},
        ]})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('picture story: a literal custom title passes through unchanged', () => {
        const story = make_story({title: 'My Story'})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('My Story')
        expect(reference_to_string).not.toHaveBeenCalled()
    })
})
