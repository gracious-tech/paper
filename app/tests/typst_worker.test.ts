
// The Typst Web Worker (typst_worker.ts), run in Node: `self` and `postMessage` are stubbed, so
// each test posts requests to the module's own message handler and reads back what it answers.
// The compiler (paper-bible-typst-web) is a fake — what's under test is the worker's protocol:
// ids echoed, progress ahead of results, one action at a time, a compile's own fonts swapped in
// and back out, and which failures are flagged fatal (the client recycles the worker on those)

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import type {CustomFont} from 'typst-fonts'
import type {TypstRequest} from 'paper-bible-typst'
import type {WorkerRequest, WorkerResponse} from '@/services/typst_worker'


// The fake compiler typst-web's init() hands back, and what init() was given
const init_typst = vi.hoisted(() => vi.fn())
vi.mock('paper-bible-typst-web', () => ({init: init_typst}))

// Which font families a request uses, per test (null = the manifest isn't loaded yet)
const used_fonts = vi.hoisted(() => ({value: null as string[]|null}))
vi.mock('paper-bible-typst', () => ({
    collect_fonts: () => {
        if (!used_fonts.value){
            throw new Error('manifest not loaded')
        }
        return used_fonts.value
    },
}))


// A request's content doesn't matter to the worker, only to the (fake) compiler
const REQUEST = {title: 'A book'} as unknown as TypstRequest

// A real PDF of the given length, since the worker counts pages with pdf-lib
async function make_pdf(pages:number):Promise<Uint8Array>{
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++){
        doc.addPage()
    }
    return await doc.save()
}

// A custom font with the given bytes
function font(family:string, ...bytes:number[]):CustomFont{
    return {family, style: 'serif', files: [new Uint8Array(bytes)]}
}


// The fake compiler: every method a spy, with defaults a test can override
function make_generator(){
    return {
        worn: false,
        set_custom_fonts: vi.fn(),
        compile_pdf: vi.fn(async (..._args:unknown[]) => await make_pdf(3)),
        compile_svg: vi.fn(async () => '<svg/>'),
        compile_svg_preview: vi.fn(async () => [{width: 1, height: 1, inner: 'a'},
            {width: 1, height: 1, inner: 'b'}]),
    }
}
let generator:ReturnType<typeof make_generator>

// The worker's message handler, and everything it posted back
let handler:(event:{data:WorkerRequest}) => void
let posted:WorkerResponse[]


// Load a fresh copy of the worker module against the stubbed worker globals
async function load_worker():Promise<void>{
    vi.resetModules()
    posted = []
    vi.stubGlobal('self', {
        addEventListener: (type:string, listener:typeof handler) => {
            expect(type).toBe('message')
            handler = listener
        },
    })
    vi.stubGlobal('postMessage', (message:WorkerResponse) => posted.push(message))
    await import('@/services/typst_worker')
}

// Post a request and wait for its result (any progress for it lands in `posted` first)
let next_id = 0
async function request(action:Record<string, unknown>):Promise<WorkerResponse>{
    const id = next_id++
    handler({data: {...action, id} as WorkerRequest})
    await vi.waitFor(() => {
        expect(posted.some(message => message.id === id && message.kind === 'result')).toBe(true)
    })
    return posted.find(message => message.id === id && message.kind === 'result')!
}

// Start the compiler, as the client always does first
async function init():Promise<void>{
    expect(await request({action: 'init', assets_prefix: 'https://assets.test/'}))
        .toMatchObject({ok: true, result: null})
}


beforeEach(async () => {
    generator = make_generator()
    init_typst.mockReset().mockImplementation(async () => generator)
    used_fonts.value = null
    // The worker logs every failure it relays; keep the test output to the assertions
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await load_worker()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})


describe('init', () => {

    it('loads both WASM modules from the assets tree, by their npm versions', async () => {
        await init()
        const [options] = init_typst.mock.calls[0] as [Record<string, string>]
        expect(options['wasm_url']).toMatch(
            /^https:\/\/assets\.test\/typst\/[\d.]+\/typst_ts_web_compiler_bg\.wasm$/)
        expect(options['renderer_wasm_url']).toMatch(
            /^https:\/\/assets\.test\/typst\/[\d.]+\/typst_ts_renderer_bg\.wasm$/)
        expect(options['assets_prefix']).toBe('https://assets.test/')
    })

    it('refuses to compile before init', async () => {
        expect(await request({action: 'compile_pdf', request: REQUEST})).toEqual({
            id: expect.any(Number), kind: 'result', ok: false,
            error: 'Typst worker used before init', fatal: false,
        })
    })

    it('counts a PDF\'s pages without a compiler, so it works even if init failed', async () => {
        const response = await request({action: 'page_count', pdf: await make_pdf(5)})
        expect(response).toMatchObject({ok: true, result: 5, pages: null})
        expect(init_typst).not.toHaveBeenCalled()
    })

})


describe('compiling', () => {

    it('answers a PDF compile with its bytes and their page count', async () => {
        await init()
        const response = await request({action: 'compile_pdf', request: REQUEST, preview: true})
        expect(response).toMatchObject({ok: true, pages: 3, worn: false})
        const result = (response as {result:Uint8Array}).result
        expect((await PDFDocument.load(result)).getPageCount()).toBe(3)
        // preview passes through, and progress goes to a callback of the worker's own
        expect(generator.compile_pdf).toHaveBeenCalledWith(REQUEST, expect.any(Function), true)
    })

    it('posts a compile\'s progress under its id, ahead of its result', async () => {
        await init()
        generator.compile_pdf.mockImplementation(async (_request, on_progress) => {
            const report = on_progress as (event:unknown) => void
            report({stage: 'fetch', i: 1, total: 2})
            report({stage: 'compile'})
            return await make_pdf(1)
        })
        const response = await request({action: 'compile_pdf', request: REQUEST})
        const mine = posted.filter(message => message.id === response.id)
        expect(mine.map(message => message.kind)).toEqual(['progress', 'progress', 'result'])
        expect(mine[0]).toEqual({id: response.id, kind: 'progress',
            event: {stage: 'fetch', i: 1, total: 2}})
    })

    it('answers an SVG preview with one page each, and a single SVG with its text', async () => {
        await init()
        expect(await request({action: 'compile_svg_preview', request: REQUEST}))
            .toMatchObject({ok: true, pages: 2, result: [{inner: 'a'}, {inner: 'b'}]})
        expect(await request({action: 'compile_svg', request: REQUEST}))
            .toMatchObject({ok: true, pages: null, result: '<svg/>'})
    })

    it('reports a worn compiler with the result, so the client can recycle the worker', async () => {
        await init()
        generator.worn = true
        expect(await request({action: 'compile_pdf', request: REQUEST}))
            .toMatchObject({ok: true, worn: true})
    })

    it('runs one action at a time, in the order they arrived', async () => {
        await init()
        // The first compile holds the compiler until released
        let release!:() => void
        generator.compile_pdf.mockImplementationOnce(async () => {
            await new Promise<void>(resolve => {
                release = resolve
            })
            return await make_pdf(1)
        })
        const first = request({action: 'compile_pdf', request: REQUEST})
        const second = request({action: 'compile_svg', request: REQUEST})
        await vi.waitFor(() => expect(release).toBeDefined())
        expect(generator.compile_svg).not.toHaveBeenCalled()
        release()
        const [a, b] = await Promise.all([first, second])
        expect(posted.indexOf(a)).toBeLessThan(posted.indexOf(b))
    })

})


describe('custom fonts', () => {

    it('passes the open design\'s fonts on to the compiler', async () => {
        await init()
        const fonts = [font('Upload', 1, 2)]
        expect(await request({action: 'set_custom_fonts', fonts})).toMatchObject({ok: true})
        expect(generator.set_custom_fonts).toHaveBeenCalledWith(fonts)
    })

    it('swaps a compile\'s own fonts in for it alone, then restores the design\'s', async () => {
        await init()
        const design = [font('Upload', 1)]
        const own = [font('Upload', 2)]
        used_fonts.value = ['Upload']
        await request({action: 'set_custom_fonts', fonts: design})
        generator.set_custom_fonts.mockClear()
        await request({action: 'compile_pdf', request: REQUEST, fonts: own})
        expect(generator.set_custom_fonts.mock.calls).toEqual([[own], [design]])
    })

    it('restores the design\'s fonts even when the compile fails', async () => {
        await init()
        const design = [font('Upload', 1)]
        await request({action: 'set_custom_fonts', fonts: design})
        generator.set_custom_fonts.mockClear()
        generator.compile_pdf.mockRejectedValueOnce(new Error('bad document'))
        const response = await request({action: 'compile_pdf', request: REQUEST,
            fonts: [font('Other', 3)]})
        expect(response).toMatchObject({ok: false, error: 'bad document'})
        expect(generator.set_custom_fonts.mock.calls.at(-1)).toEqual([design])
    })

    it('skips the swap when the fonts the request uses are identical', async () => {
        await init()
        // Families the request doesn't use may differ freely
        used_fonts.value = ['Upload']
        await request({action: 'set_custom_fonts',
            fonts: [font('Upload', 1, 2), font('Unused', 9)]})
        generator.set_custom_fonts.mockClear()
        await request({action: 'compile_pdf', request: REQUEST, fonts: [font('Upload', 1, 2)]})
        expect(generator.set_custom_fonts).not.toHaveBeenCalled()
    })

    it('swaps when a used family differs in bytes, files or presence', async () => {
        await init()
        used_fonts.value = ['Upload', 'Second']
        await request({action: 'set_custom_fonts', fonts: [font('Upload', 1, 2)]})
        const variants = [
            // Same length, different bytes
            [font('Upload', 1, 3)],
            // Different length
            [font('Upload', 1)],
            // A different number of files
            [{...font('Upload', 1, 2), files: [new Uint8Array([1, 2]), new Uint8Array([4])]}],
            // Another used family as well
            [font('Upload', 1, 2), font('Second', 5)],
            // The used family missing, another in its place
            [font('Second', 1, 2)],
        ]
        for (const fonts of variants){
            generator.set_custom_fonts.mockClear()
            await request({action: 'compile_pdf', request: REQUEST, fonts})
            expect(generator.set_custom_fonts).toHaveBeenCalledWith(fonts)
        }
    })

    it('swaps whenever the font manifest isn\'t loaded, since it can\'t tell', async () => {
        await init()
        const fonts = [font('Upload', 1)]
        await request({action: 'set_custom_fonts', fonts})
        generator.set_custom_fonts.mockClear()
        await request({action: 'compile_pdf', request: REQUEST, fonts})
        expect(generator.set_custom_fonts).toHaveBeenCalledTimes(2)
    })

})


describe('failures', () => {

    // Fail the next compile with the given throwable, and return what the worker answered
    async function fail_with(error:unknown):Promise<WorkerResponse>{
        generator.compile_pdf.mockImplementationOnce(() => Promise.reject(error))
        return await request({action: 'compile_pdf', request: REQUEST})
    }

    it('flags a WASM trap as fatal', async () => {
        await init()
        expect(await fail_with(new WebAssembly.RuntimeError('unreachable')))
            .toMatchObject({ok: false, error: 'unreachable', fatal: true})
    })

    it('flags a stack overflow as fatal, but not any other RangeError', async () => {
        await init()
        expect(await fail_with(new RangeError('Maximum call stack size exceeded')))
            .toMatchObject({fatal: true})
        expect(await fail_with(new RangeError('Invalid array length')))
            .toMatchObject({fatal: false})
    })

    it('relays an ordinary error\'s message, and a non-Error throwable as text', async () => {
        await init()
        expect(await fail_with(new Error('unknown variable: foo')))
            .toMatchObject({ok: false, error: 'unknown variable: foo', fatal: false})
        expect(await fail_with('plain string')).toMatchObject({ok: false, error: 'plain string'})
    })

    it('keeps answering after a failure', async () => {
        await init()
        await fail_with(new Error('bad'))
        expect(await request({action: 'compile_svg', request: REQUEST})).toMatchObject({ok: true})
    })

})
