
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {BibleContent} from '../src/bible_content.js'

import type {BibleCollection} from '@gracious.tech/fetch-client'


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
