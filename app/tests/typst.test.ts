
// TypstWorkerClient (typst.ts): the main thread's side of the Typst worker, driven against a
// fake Worker. What's under test is what makes the worker disposable — results matched to
// requests by id, progress forwarded, a worn worker recycled between requests, a trapped one
// recycled at once with every queued request failed and compiles retried once, an abandoned
// one replaced — and that each fresh worker is given init and the custom fonts again

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import type {CustomFont} from 'typst-fonts'
import type {TypstRequest} from 'paper-bible-typst'
import type {WorkerRequest, WorkerResponse} from '@/services/typst_worker'


// compile_mode marks a compile as running and owns the device-limit error; only the latter
// matters here, so the former just passes the compile through (and records that it was asked)
const compile_mode = vi.hoisted(() => ({
    BrowserMemoryError: class BrowserMemoryError extends Error {},
    track_browser_compile: vi.fn(<T>(compile:Promise<T>) => compile),
}))
vi.mock('@/services/compile_mode', () => compile_mode)


// A stand-in for the Web Worker: records what it's sent, and answers init and set_custom_fonts
// by itself (a recycle waits on both) unless a test holds those back
class FakeWorker {
    static instances:FakeWorker[] = []
    sent:WorkerRequest[] = []
    terminated = false
    onmessage:((event:{data:WorkerResponse}) => void)|null = null
    onerror:((event:{message:string}) => void)|null = null

    constructor(){
        FakeWorker.instances.push(this)
    }

    postMessage(message:WorkerRequest){
        this.sent.push(message)
        if (message.action === 'init' || message.action === 'set_custom_fonts'){
            queueMicrotask(() => this.ok(message.id, null))
        }
    }

    terminate(){
        this.terminated = true
    }

    // Answer a request as the worker would
    reply(response:WorkerResponse){
        this.onmessage?.({data: response})
    }

    // Answer a request successfully
    ok(id:number, result:unknown, extra:{pages?:number|null, worn?:boolean} = {}){
        this.reply({id, kind: 'result', ok: true, result: result as null, pages: extra.pages ?? null,
            worn: extra.worn ?? false})
    }

    // Fail a request, fatally (a WASM trap) or not
    fail(id:number, error:string, fatal = false){
        this.reply({id, kind: 'result', ok: false, error, fatal})
    }

    // The last request of a given action this worker was sent, once it has been
    async next(action:string):Promise<WorkerRequest>{
        await vi.waitFor(() => expect(this.sent.some(message => message.action === action))
            .toBe(true))
        return this.sent.filter(message => message.action === action).at(-1)!
    }
}

// The worker currently in use (the newest one spawned)
function worker():FakeWorker{
    return FakeWorker.instances.at(-1)!
}


// A request's content is the worker's business
const REQUEST = {title: 'A book'} as unknown as TypstRequest
const PDF = new Uint8Array([37, 80, 68, 70])
const FONTS:CustomFont[] = [{family: 'Upload', style: 'serif', files: [new Uint8Array([1])]}]


// A fresh client, already through init
async function make_client(){
    const {TypstWorkerClient} = await import('@/services/typst')
    const client = new TypstWorkerClient()
    await client.init('https://assets.test/')
    return client
}


beforeEach(() => {
    FakeWorker.instances = []
    compile_mode.track_browser_compile.mockClear()
    vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('requests', () => {

    it('starts the worker\'s compiler from the assets tree', async () => {
        await make_client()
        expect(worker().sent).toEqual([{action: 'init', assets_prefix: 'https://assets.test/', id: 0}])
    })

    it('answers each request with its own result, whatever order they come back in', async () => {
        const client = await make_client()
        const first = client.page_count(PDF)
        const second = client.page_count(PDF)
        await vi.waitFor(() => expect(worker().sent).toHaveLength(3))
        const [, a, b] = worker().sent
        worker().ok(b!.id, 7)
        worker().ok(a!.id, 4)
        expect(await Promise.all([first, second])).toEqual([4, 7])
    })

    it('forwards a compile\'s progress, and ignores answers to nothing it asked', async () => {
        const client = await make_client()
        const progress = vi.fn()
        const compiled = client.compile_pdf(REQUEST, progress, true, FONTS)
        const sent = await worker().next('compile_pdf')
        expect(sent).toMatchObject({request: REQUEST, preview: true, fonts: FONTS})
        worker().reply({id: sent.id, kind: 'progress', event: {stage: 'compile'}})
        worker().reply({id: 999, kind: 'progress', event: {stage: 'fetch', label: 'x'}})
        worker().ok(999, 'stray')
        worker().ok(sent.id, PDF, {pages: 12})
        expect(await compiled).toEqual({bytes: PDF, pages: 12})
        expect(progress.mock.calls).toEqual([[{stage: 'compile'}]])
        // A compile is marked as running for its whole length (see compile_mode.ts)
        expect(compile_mode.track_browser_compile).toHaveBeenCalledTimes(1)
    })

    it('returns SVG output as the worker gives it', async () => {
        const client = await make_client()
        const svg = client.compile_svg(REQUEST)
        worker().ok((await worker().next('compile_svg')).id, '<svg/>')
        expect(await svg).toBe('<svg/>')
        const pages = client.compile_svg_preview(REQUEST)
        worker().ok((await worker().next('compile_svg_preview')).id, [{inner: 'a'}], {pages: 1})
        expect(await pages).toEqual([{inner: 'a'}])
    })

    it('fails a request the worker couldn\'t do, without replacing the worker', async () => {
        const client = await make_client()
        const compiled = client.compile_pdf(REQUEST)
        worker().fail((await worker().next('compile_pdf')).id, 'unknown variable: foo')
        await expect(compiled).rejects.toThrow('unknown variable: foo')
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('fails everything in flight when the worker script itself crashes', async () => {
        const client = await make_client()
        const first = client.compile_pdf(REQUEST)
        const second = client.page_count(PDF)
        await vi.waitFor(() => expect(worker().sent).toHaveLength(3))
        worker().onerror!({message: 'Uncaught SyntaxError'})
        await expect(first).rejects.toThrow('Uncaught SyntaxError')
        await expect(second).rejects.toThrow('Uncaught SyntaxError')

        // A crash with no message still says what failed
        const third = client.page_count(PDF)
        await worker().next('page_count')
        worker().onerror!({message: ''})
        await expect(third).rejects.toThrow('Typst worker failed')
    })

})


describe('recycling', () => {

    it('replaces a worn worker once its last request is answered, replaying init and fonts', async () => {
        const client = await make_client()
        await client.set_custom_fonts(FONTS)
        const first = client.compile_pdf(REQUEST)
        const second = client.compile_pdf(REQUEST)
        await vi.waitFor(() => expect(worker().sent).toHaveLength(4))
        const old = worker()
        const [, , a, b] = old.sent

        // Worn, but another request is still in flight there: it's kept until that's answered
        old.ok(a!.id, PDF, {pages: 1, worn: true})
        await first
        expect(old.terminated).toBe(false)
        old.ok(b!.id, PDF, {pages: 1})
        await second
        expect(old.terminated).toBe(true)

        // The fresh worker is set up as the old one was, before anything else is sent to it
        const fresh = worker()
        expect(fresh).not.toBe(old)
        expect(fresh.sent.map(message => message.action)).toEqual(['init', 'set_custom_fonts'])
        expect(fresh.sent[1]).toMatchObject({fonts: FONTS})
        const counted = client.page_count(PDF)
        fresh.ok((await fresh.next('page_count')).id, 2)
        expect(await counted).toBe(2)
    })

    it('retries a compile that trapped on a fresh worker, failing everything else queued', async () => {
        const client = await make_client()
        const compiled = client.compile_pdf(REQUEST)
        const counted = client.page_count(PDF)
        await vi.waitFor(() => expect(worker().sent).toHaveLength(3))
        const old = worker()
        old.fail(old.sent[1]!.id, 'unreachable', true)

        // The other request isn't a compile, so it isn't retried
        await expect(counted).rejects.toThrow('unreachable')
        expect(old.terminated).toBe(true)
        const fresh = worker()
        fresh.ok((await fresh.next('compile_pdf')).id, PDF, {pages: 3})
        expect(await compiled).toEqual({bytes: PDF, pages: 3})
    })

    it('blames the device\'s memory when the retry traps too', async () => {
        const client = await make_client()
        const compiled = client.compile_pdf(REQUEST)
        worker().fail((await worker().next('compile_pdf')).id, 'unreachable', true)
        await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
        worker().fail((await worker().next('compile_pdf')).id, 'out of memory', true)
        const error = await compiled.catch((caught:unknown) => caught)
        expect(error).toBeInstanceOf(compile_mode.BrowserMemoryError)
        expect((error as Error).message).toMatch(/too large.*out of memory/)
    })

    it('passes on an ordinary failure of the retry as it is', async () => {
        const client = await make_client()
        const compiled = client.compile_svg(REQUEST)
        worker().fail((await worker().next('compile_svg')).id, 'unreachable', true)
        await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
        worker().fail((await worker().next('compile_svg')).id, 'unknown font')
        await expect(compiled).rejects.toThrow(/^unknown font$/)
    })

    it('abandons everything in flight on request, and carries on with a fresh worker', async () => {
        const {AbandonedCompileError} = await import('@/services/typst')
        const client = await make_client()
        const compiled = client.compile_pdf(REQUEST)
        await worker().next('compile_pdf')
        const old = worker()
        client.abandon()
        await expect(compiled).rejects.toBeInstanceOf(AbandonedCompileError)
        expect(old.terminated).toBe(true)
        const counted = client.page_count(PDF)
        worker().ok((await worker().next('page_count')).id, 1)
        expect(await counted).toBe(1)
    })

    it('releases memory at once when idle, and after the last request when busy', async () => {
        const client = await make_client()
        client.release_memory()
        await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
        expect(FakeWorker.instances[0]!.terminated).toBe(true)

        const counted = client.page_count(PDF)
        const busy = worker()
        const sent = await busy.next('page_count')
        client.release_memory()
        expect(busy.terminated).toBe(false)
        busy.ok(sent.id, 1)
        await counted
        expect(busy.terminated).toBe(true)
        expect(FakeWorker.instances).toHaveLength(3)
    })

    it('settles new fonts through a recycle that a queued compile\'s trap set off', async () => {
        const client = await make_client()
        const compiled = client.compile_svg(REQUEST)
        await worker().next('compile_svg')
        const old = worker()
        // Held back, so the fonts are still waiting when the compile ahead of them traps
        old.postMessage = message => {
            old.sent.push(message)
        }
        const fonts_set = client.set_custom_fonts(FONTS)
        const fonts_message = await old.next('set_custom_fonts')
        old.fail(old.sent.find(message => message.action === 'compile_svg')!.id, 'trap', true)
        // The fresh worker gets the fonts replayed, and that's what set_custom_fonts waits on
        await fonts_set
        expect(worker()).not.toBe(old)
        expect(worker().sent.find(message => message.action === 'set_custom_fonts'))
            .toMatchObject({fonts: FONTS})
        expect(fonts_message.id).toBeDefined()
        worker().ok((await worker().next('compile_svg')).id, '<svg/>')
        expect(await compiled).toBe('<svg/>')
    })

    it('still fails set_custom_fonts for an error that isn\'t a lost worker', async () => {
        const client = await make_client()
        const old = worker()
        old.postMessage = message => {
            old.sent.push(message)
        }
        const fonts_set = client.set_custom_fonts(FONTS)
        old.fail((await old.next('set_custom_fonts')).id, 'Typst worker used before init')
        await expect(fonts_set).rejects.toThrow('Typst worker used before init')
    })

})
