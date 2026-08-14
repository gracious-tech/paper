
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {BibleContent, resolve_declared_cjk_variant} from '../src/bible_content.js'

import type {BibleCollection, GetResourcesItem} from '@gracious.tech/fetch-client'


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
