// Moving a design's assets between Storage prefixes (design_assets.ts): the public url a frozen
// blueprint names before its object exists, the copy jobs that make sure each snapshot is in
// place (skipping what already is, and treating a refused create of an object that now exists
// as the success it is), and the debounced request for the server to reclaim unused uploads

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// Storage as a set of paths that exist, with each object's bytes
const objects = vi.hoisted(() => new Map<string, Uint8Array>())
const upload_bytes = vi.hoisted(() => vi.fn(async (path:string, bytes:Uint8Array,
        _metadata?:{contentType:string}) => {
    objects.set(path, bytes)
}))
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => path,
    getMetadata: async (path:string) => {
        if (!objects.has(path)){
            throw new Error('storage/object-not-found')
        }
        return {}
    },
    getBytes: async (path:string) => objects.get(path)!.buffer,
    uploadBytes: upload_bytes,
}))
vi.mock('@/services/firebase', () => ({firebase_storage: {}, storage_bucket: 'bucket.test'}))

// The reconcile request, and where its failures go
const api_mock = vi.hoisted(() => vi.fn(async () => ({swept: 0})))
vi.mock('@/services/api', () => ({api: api_mock}))
const report_error = vi.hoisted(() => vi.fn())
vi.mock('@/services/errors', () => ({report_error}))

const {storage_public_url, apply_asset_copies, request_reconcile}
    = await import('@/services/design_assets')


beforeEach(() => {
    objects.clear()
    upload_bytes.mockClear()
    api_mock.mockClear()
    report_error.mockClear()
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
})


describe('storage_public_url', () => {

    // Built rather than fetched, so the whole path is one encoded segment and needs no auth
    it('addresses the production bucket, with the path as one encoded segment', () => {
        vi.stubEnv('DEV', false)
        expect(storage_public_url('version_assets/d1/abc.png')).toBe(
            'https://firebasestorage.googleapis.com/v0/b/bucket.test/o/'
            + 'version_assets%2Fd1%2Fabc.png?alt=media')
    })

    // (The dev branch reads EMULATOR_PORTS, an object vite.config.mts defines; vitest's
    // import.meta.env only holds strings, so it's left to the journeys, which run against it)

})


describe('apply_asset_copies', () => {

    // Bytes in hand are uploaded as given; bytes elsewhere are read from their source first
    it('uploads bytes in hand, and copies the rest from their source', async () => {
        objects.set('design_assets/d1/abc.png', new Uint8Array([1, 2, 3]))
        await apply_asset_copies([
            {to: 'version_assets/d1/new.ttf', bytes: new Uint8Array([9]), content_type: 'font/ttf'},
            {to: 'version_assets/d1/abc.png', from: 'design_assets/d1/abc.png',
                content_type: 'image/png'},
        ])
        expect([...objects.get('version_assets/d1/new.ttf')!]).toEqual([9])
        expect([...objects.get('version_assets/d1/abc.png')!]).toEqual([1, 2, 3])
        expect(upload_bytes.mock.calls.map(call => [call[0], call[2]])).toEqual([
            ['version_assets/d1/new.ttf', {contentType: 'font/ttf'}],
            ['version_assets/d1/abc.png', {contentType: 'image/png'}],
        ])
    })

    // Content-addressing means a re-render finds its snapshots already there: nothing moves
    it('skips a destination that already exists, without reading its source', async () => {
        objects.set('version_assets/d1/abc.png', new Uint8Array([1]))
        await apply_asset_copies([{to: 'version_assets/d1/abc.png',
            from: 'design_assets/d1/missing.png', content_type: 'image/png'}])
        expect(upload_bytes).not.toHaveBeenCalled()
    })

    // version_assets/ is append-only, so a refused create usually means a co-editor froze the
    // same bytes first — which is exactly what was wanted
    it('treats a refused upload as done when the object turns out to exist', async () => {
        upload_bytes.mockImplementationOnce(async (path:string) => {
            objects.set(path, new Uint8Array([7]))
            throw new Error('storage/unauthorized')
        })
        await expect(apply_asset_copies([{to: 'version_assets/d1/raced.png',
            bytes: new Uint8Array([7]), content_type: 'image/png'}])).resolves.toBeUndefined()
    })

    // ...but a refusal that left nothing behind is a real failure
    it('rethrows a refused upload when nothing was written', async () => {
        upload_bytes.mockRejectedValueOnce(new Error('storage/unauthorized'))
        await expect(apply_asset_copies([{to: 'version_assets/d1/denied.png',
            bytes: new Uint8Array([7]), content_type: 'image/png'}]))
            .rejects.toThrow('storage/unauthorized')
    })

})


describe('request_reconcile', () => {

    // A burst of edits costs one request per design, once things go quiet
    it('debounces a burst into one request per design', async () => {
        vi.useFakeTimers()
        request_reconcile('d1')
        request_reconcile('d1')
        request_reconcile('d2')
        await vi.advanceTimersByTimeAsync(4000)
        expect(api_mock).not.toHaveBeenCalled()
        request_reconcile('d1')
        await vi.advanceTimersByTimeAsync(5000)
        expect(api_mock.mock.calls).toEqual([
            ['/api/reconcile_design_assets', {design_id: 'd1'}],
            ['/api/reconcile_design_assets', {design_id: 'd2'}],
        ])

        // Nothing is left pending afterwards
        await vi.advanceTimersByTimeAsync(10000)
        expect(api_mock).toHaveBeenCalledTimes(2)
    })

    // It only reclaims space, so a failure is reported quietly and the next edit retries
    it('reports a failed request silently', async () => {
        vi.useFakeTimers()
        const failure = new Error('offline')
        api_mock.mockRejectedValueOnce(failure)
        request_reconcile('d3')
        await vi.advanceTimersByTimeAsync(5000)
        expect(report_error).toHaveBeenCalledWith('silent', failure,
            {context: {stage: 'reconcile_design_assets'}})
    })

})
