
// Previews made on the server (server_preview.ts): what's sent before asking (a flush, and the
// masked image variants the server can't make), how the outcome on the previews/{id} doc decides
// the result (a failure, a timeout, a file gzipped or not), and whether the page estimate it
// brings is kept. The Firestore listener, Storage read and API are stand-ins each test drives

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {set_blue} from './stubs/state'


// The snapshot listener the module registers, and whatever it was told to do on an error
const listener = vi.hoisted(() => ({
    on_next: null as ((snapshot:{data:() => unknown}) => void)|null,
    on_error: null as ((error:unknown) => void)|null,
    unsubscribe: vi.fn(),
}))

// The rest of the module's collaborators, controlled per test
const mocks = vi.hoisted(() => ({
    api: vi.fn(),
    get_bytes: vi.fn(),
    flush_changes: vi.fn(async () => undefined),
    resolve_content_for_style: vi.fn(async () => undefined),
    set_page_estimate: vi.fn(),
    fresh_estimate: vi.fn(() => null as number|null),
    signature: {value: 'sig_1'},
    settle_server_mode: vi.fn(),
    remember_previewed_cover: vi.fn(),
    report_error: vi.fn(),
    design_id: {value: 'design_1' as string|null},
}))

vi.mock('firebase/firestore', () => ({
    doc: (_db:unknown, collection:string, id:string) => `${collection}/${id}`,
    onSnapshot: (_ref:unknown, on_next:typeof listener.on_next, on_error:typeof listener.on_error) => {
        listener.on_next = on_next
        listener.on_error = on_error
        return listener.unsubscribe
    },
}))
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => path,
    getBytes: mocks.get_bytes,
}))
vi.mock('@/services/firebase', () => ({firestore: {}, firebase_storage: {}}))
vi.mock('@/services/api', () => ({
    api: mocks.api,
    ApiOfflineError: class extends Error {},
}))
vi.mock('@/services/designs', () => ({
    current_design_id: mocks.design_id,
    flush_changes: mocks.flush_changes,
}))
vi.mock('@/services/content_images', () => ({
    resolve_content_for_style: mocks.resolve_content_for_style,
}))
vi.mock('@/services/image_frame', () => ({
    is_masked_image_style: (style:string) => style === 'painted' || style === 'torn',
}))
vi.mock('@/services/page_estimate', () => ({
    render_signature: () => mocks.signature.value,
    set_page_estimate: mocks.set_page_estimate,
    fresh_estimate: mocks.fresh_estimate,
}))
vi.mock('@/services/network_retry', () => ({retry_network: (action:() => unknown) => action()}))
vi.mock('@/services/compile_mode', () => ({settle_server_mode: mocks.settle_server_mode}))
vi.mock('@/services/cover', () => ({
    remember_previewed_cover: mocks.remember_previewed_cover,
    cover_json: () => 'cover_json',
}))
vi.mock('@/services/errors', () => ({report_error: mocks.report_error}))


import {
    request_server_preview, ensure_server_estimate, ServerPreviewError, SERVER_PREVIEW_TIMEOUT_MS,
} from '@/services/server_preview'


// The JSON file a finished preview leaves in Storage
const PREVIEW_FILE = {pages: [{inner: 'page 1'}], covers: [{inner: 'cover'}]}


// The preview's file as bytes, gzipped if asked (as stored, and as served by an emulator)
async function file_bytes(gzip = false):Promise<ArrayBuffer>{
    const json = new TextEncoder().encode(JSON.stringify(PREVIEW_FILE))
    if (!gzip){
        return json.buffer
    }
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).arrayBuffer()
}


// Settle the preview's doc as the server would
function settle(doc:Record<string, unknown>):void{
    listener.on_next!({data: () => ({path: null, page_estimate: null, truncated: null,
        dropped_before: null, dropped_after: null, error_id: null, ...doc})})
}


// Let the request get as far as listening for its doc
async function until_listening():Promise<void>{
    await vi.waitFor(() => expect(listener.on_next).not.toBe(null))
}


beforeEach(() => {
    listener.on_next = null
    listener.on_error = null
    listener.unsubscribe.mockClear()
    for (const mock of Object.values(mocks)){
        if (typeof mock === 'function'){
            mock.mockClear()
        }
    }
    mocks.api.mockResolvedValue({preview_id: 'preview_1'})
    mocks.fresh_estimate.mockReturnValue(null)
    mocks.signature.value = 'sig_1'
    mocks.design_id.value = 'design_1'
    set_blue({image_style: 'plain', content: [], cover: null} as never)
})

afterEach(() => {
    vi.useRealTimers()
})


describe('request_server_preview', () => {

    it('refuses with no design open', async () => {
        mocks.design_id.value = null
        await expect(request_server_preview('phone', 'start')).rejects.toThrow(/No design open/)
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('flushes, asks, and returns the pages and covers the server made', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const progress = vi.fn()
        const pending = request_server_preview('desktop', 'end', progress)
        await until_listening()
        settle({status: 'available', path: 'design_cache/design_1/preview_1.json',
            truncated: true, dropped_before: true})
        const preview = await pending

        expect(progress).toHaveBeenCalledWith({stage: 'server'})
        expect(mocks.flush_changes).toHaveBeenCalled()
        expect(mocks.api).toHaveBeenCalledWith('/api/preview',
            {design_id: 'design_1', page_count: 0, size: 'desktop', section: 'end'})
        expect(mocks.get_bytes).toHaveBeenCalledWith('design_cache/design_1/preview_1.json')
        expect(preview).toEqual({...PREVIEW_FILE, truncated: true, dropped_before: true,
            dropped_after: false})
        // A success settles a provisional switch to the server, and the listener is dropped
        expect(mocks.settle_server_mode).toHaveBeenCalledWith(true)
        expect(listener.unsubscribe).toHaveBeenCalled()
        // A desktop's cover is remembered against the cover it was rendered from
        expect(mocks.remember_previewed_cover)
            .toHaveBeenCalledWith('design_1', 'cover_json', PREVIEW_FILE.covers[0])
    })

    it('doesn\'t remember a phone\'s cover', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json'})
        await pending
        expect(mocks.remember_previewed_cover).not.toHaveBeenCalled()
    })

    it('makes the masked image variants first, for a painted or torn design', async () => {
        set_blue({image_style: 'painted', content: [{id: 'c1'}], cover: null} as never)
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json'})
        await pending
        expect(mocks.resolve_content_for_style)
            .toHaveBeenCalledWith('design_1', [{id: 'c1'}], 'painted')
    })

    it('makes no variants for an unmasked design', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json'})
        await pending
        expect(mocks.resolve_content_for_style).not.toHaveBeenCalled()
    })

    it('ungzips a file served still gzipped', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes(true))
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json'})
        expect((await pending).pages).toEqual(PREVIEW_FILE.pages)
    })

    it('waits out pending snapshots until the doc is settled', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        // Not yet written, then still pending: neither is an answer
        listener.on_next!({data: () => undefined})
        settle({status: 'pending'})
        expect(listener.unsubscribe).not.toHaveBeenCalled()
        settle({status: 'available', path: 'p.json'})
        await pending
    })

    it('throws the server\'s error id when it failed, and settles the switch against it', async () => {
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'failed', error_id: 'err_42'})
        const error = await pending.catch((caught:unknown) => caught)
        expect(error).toBeInstanceOf(ServerPreviewError)
        expect((error as ServerPreviewError).error_id).toBe('err_42')
        expect(mocks.settle_server_mode).toHaveBeenCalledWith(false)
        expect(mocks.get_bytes).not.toHaveBeenCalled()
    })

    it('treats an available doc with no file as a failure', async () => {
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: null})
        await expect(pending).rejects.toBeInstanceOf(ServerPreviewError)
    })

    it('gives up on a preview the server never settles', async () => {
        vi.useFakeTimers()
        const pending = request_server_preview('phone', 'start')
        const caught = pending.catch((error:unknown) => error)
        await vi.waitFor(() => expect(listener.on_next).not.toBe(null))
        await vi.advanceTimersByTimeAsync(SERVER_PREVIEW_TIMEOUT_MS)
        const error = await caught
        expect(error).toBeInstanceOf(ServerPreviewError)
        expect((error as Error).message).toMatch(/too long/)
        expect((error as ServerPreviewError).error_id).toBe(null)
        expect(listener.unsubscribe).toHaveBeenCalled()
    })

    it('passes on the listener\'s own error', async () => {
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        listener.on_error!(new Error('permission-denied'))
        await expect(pending).rejects.toThrow('permission-denied')
        expect(listener.unsubscribe).toHaveBeenCalled()
    })

    it('keeps the server\'s page estimate only while the design is unchanged', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json', page_estimate: 12})
        await pending
        expect(mocks.set_page_estimate).toHaveBeenCalledWith(12, 'sig_1')

        // Edited while the server worked: the estimate describes a design that's gone
        mocks.set_page_estimate.mockClear()
        const stale = request_server_preview('phone', 'start')
        listener.on_next = null
        await until_listening()
        mocks.signature.value = 'sig_2'
        settle({status: 'available', path: 'p.json', page_estimate: 12})
        await stale
        expect(mocks.set_page_estimate).not.toHaveBeenCalled()
    })

    it('keeps no estimate when the server brought none', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const pending = request_server_preview('phone', 'start')
        await until_listening()
        settle({status: 'available', path: 'p.json', page_estimate: null})
        await pending
        expect(mocks.set_page_estimate).not.toHaveBeenCalled()
    })

})


describe('ensure_server_estimate', () => {

    it('asks nothing when the estimate is fresh, or no design is open', async () => {
        mocks.fresh_estimate.mockReturnValue(8)
        await ensure_server_estimate(1000)
        mocks.fresh_estimate.mockReturnValue(null)
        mocks.design_id.value = null
        await ensure_server_estimate(1000)
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('has concurrent callers for the same design share one preview', async () => {
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        const first = ensure_server_estimate(60_000)
        const second = ensure_server_estimate(60_000)
        await until_listening()
        settle({status: 'available', path: 'p.json', page_estimate: 5})
        await Promise.all([first, second])
        expect(mocks.api).toHaveBeenCalledTimes(1)
        expect(mocks.set_page_estimate).toHaveBeenCalledWith(5, 'sig_1')
    })

    it('stops waiting after max_wait_ms, while the estimate still lands later', async () => {
        vi.useFakeTimers()
        mocks.get_bytes.mockResolvedValue(await file_bytes())
        let waited = false
        const waiting = ensure_server_estimate(5000).then(() => {
            waited = true
        })
        await vi.waitFor(() => expect(listener.on_next).not.toBe(null))
        await vi.advanceTimersByTimeAsync(5000)
        await waiting
        expect(waited).toBe(true)
        expect(mocks.set_page_estimate).not.toHaveBeenCalled()

        settle({status: 'available', path: 'p.json', page_estimate: 7})
        await vi.waitFor(() => expect(mocks.set_page_estimate).toHaveBeenCalledWith(7, 'sig_1'))
    })

    it('never throws, reporting a failure unless the server already filed one', async () => {
        // The server failed and reported it (it has an id): nothing more to report
        const reported_by_server = ensure_server_estimate(60_000)
        await until_listening()
        settle({status: 'failed', error_id: 'err_1'})
        await reported_by_server
        expect(mocks.report_error).not.toHaveBeenCalled()

        // Refused outright: nobody else has reported that
        mocks.api.mockRejectedValueOnce(new Error('quota exceeded'))
        await ensure_server_estimate(60_000)
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {context: {stage: 'server_estimate'}})
    })

})
