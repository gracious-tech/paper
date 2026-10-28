
// The cover Web Worker (cover_worker.ts), run in Node with `self` and `postMessage` stubbed, and
// bookcover-web faked. What's under test is the protocol: the custom fonts a generate names by
// key (their bytes sent only when the key changes, and adopted before anything can fail, so the
// worker never disagrees with the client about the last set), what a generate hands bookcover,
// and failures relayed with their original stack

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import type {CustomFont} from 'typst-fonts'
import type {CoverWorkerRequest, CoverWorkerResponse} from '@/services/cover_worker'


// The fake generator bookcover-web's init() hands back, and the schema builder
const init_bookcover = vi.hoisted(() => vi.fn())
const build_schema = vi.hoisted(() => vi.fn((..._args:unknown[]) => ({schema: true})))
vi.mock('bookcover-web', () => ({init: init_bookcover, build_schema}))


// The fake generator: generate answers a full render plus its split panels
function make_generator(){
    return {
        generate: vi.fn(async (_options:Record<string, unknown>) => ({
            data: new Uint8Array([1]),
            split: {front: new Uint8Array([2]), back: new Uint8Array([3]) as Uint8Array,
                spine: undefined as Uint8Array|undefined},
        })),
    }
}
let generator:ReturnType<typeof make_generator>

// The worker's message handler, and everything it posted back
let handler:(event:{data:CoverWorkerRequest}) => void
let posted:CoverWorkerResponse[]

// A form, as the client sends it (its contents are bookcover's business)
const FORM = {title: 'A book'}


// Load a fresh copy of the worker module against the stubbed worker globals
async function load_worker():Promise<void>{
    vi.resetModules()
    posted = []
    vi.stubGlobal('self', {
        addEventListener: (_type:string, listener:typeof handler) => {
            handler = listener
        },
    })
    vi.stubGlobal('postMessage', (message:CoverWorkerResponse) => posted.push(message))
    await import('@/services/cover_worker')
}

// Post a request and wait for the worker's answer to it
let next_id = 0
async function request(action:Record<string, unknown>):Promise<CoverWorkerResponse>{
    const id = next_id++
    handler({data: {...action, id} as CoverWorkerRequest})
    await vi.waitFor(() => expect(posted.some(message => message.id === id)).toBe(true))
    return posted.find(message => message.id === id)!
}

// Start bookcover, as the client always does first
async function init():Promise<void>{
    expect(await request({action: 'init', assets_prefix: 'https://assets.test/'}))
        .toMatchObject({ok: true, result: null})
}

// A generate with the defaults the tests don't care about
function generate(overrides:Record<string, unknown> = {}):Promise<CoverWorkerResponse>{
    return request({action: 'generate', fonts_key: '', form: FORM, image: null, ...overrides})
}

// The options the last generate handed bookcover
function last_generate():Record<string, unknown>{
    return generator.generate.mock.calls.at(-1)![0]
}


beforeEach(async () => {
    generator = make_generator()
    init_bookcover.mockReset().mockImplementation(async () => generator)
    build_schema.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await load_worker()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})


describe('init', () => {

    it('points bookcover at the WASM, templates and fonts of the one assets tree', async () => {
        await init()
        expect(init_bookcover).toHaveBeenCalledWith({
            wasm_url: expect.stringMatching(
                /^https:\/\/assets\.test\/typst\/[\d.]+\/typst_ts_web_compiler_bg\.wasm$/),
            renderer_wasm_url: expect.stringMatching(
                /^https:\/\/assets\.test\/typst\/[\d.]+\/typst_ts_renderer_bg\.wasm$/),
            assets_prefix: 'https://assets.test/',
            fonts_prefix: 'https://assets.test/fonts',
        })
    })

    it('refuses to generate before init, relaying where it threw', async () => {
        const response = await generate()
        expect(response).toMatchObject({ok: false, error: 'Cover worker used before init'})
        expect((response as {stack:string}).stack).toContain('cover_worker')
    })

})


describe('generate', () => {

    it('renders the form\'s schema as a PDF split into its panels by default', async () => {
        await init()
        const response = await generate()
        expect(build_schema).toHaveBeenCalledWith(FORM, [], undefined)
        expect(last_generate()).toEqual({schema: {schema: true}, format: 'pdf', split: true,
            custom_fonts: []})
        // No spine for a binding without one
        expect(response).toEqual({id: response.id, ok: true, result: {
            data: new Uint8Array([1]), front: new Uint8Array([2]), back: new Uint8Array([3])}})
    })

    it('passes the spine on when the binding has one', async () => {
        await init()
        generator.generate.mockResolvedValueOnce({data: new Uint8Array([1]), split: {
            front: new Uint8Array([2]), back: new Uint8Array([3]), spine: new Uint8Array([4])}})
        expect(await generate()).toMatchObject({result: {spine: new Uint8Array([4])}})
    })

    it('hands bookcover the image as a File it can recognise again by its key', async () => {
        await init()
        await generate({image: {data: new Uint8Array([7, 8]), type: 'image/png', key: 'bg_v1'}})
        const image = last_generate()['image'] as File
        expect(image).toBeInstanceOf(File)
        expect(image.name).toBe('bg_v1')
        expect(image.type).toBe('image/png')
        expect(image.lastModified).toBe(0)
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([7, 8]))
    })

    it('passes the optional render settings only when given', async () => {
        await init()
        await generate({image_builtin: 'linen.jpg', image_max_dpi: 150, format: 'svg',
            typst_substitutions: {'AUTO-COPYRIGHT': '#text[(c)]'}})
        expect(last_generate()).toMatchObject({image_builtin: 'linen.jpg', image_max_dpi: 150,
            format: 'svg'})
        expect(build_schema).toHaveBeenLastCalledWith(FORM, [],
            {typst_substitutions: {'AUTO-COPYRIGHT': '#text[(c)]'}})
        await generate()
        expect(last_generate()).not.toHaveProperty('image_builtin')
        expect(last_generate()).not.toHaveProperty('image_max_dpi')
        expect(last_generate()).not.toHaveProperty('image')
    })

    it('relays bookcover\'s failure, and a non-Error throwable as text without a stack', async () => {
        await init()
        generator.generate.mockRejectedValueOnce(new Error('template missing'))
        expect(await generate()).toMatchObject({ok: false, error: 'template missing',
            stack: expect.any(String)})
        generator.generate.mockImplementationOnce(() => Promise.reject('plain string'))
        const response = await generate()
        expect(response).toEqual({id: response.id, ok: false, error: 'plain string'})
    })

})


describe('custom fonts', () => {

    const FONTS:CustomFont[] = [
        {family: 'Upload', style: 'sans', files: [new Uint8Array([1]), new Uint8Array([2])]},
    ]

    it('renders with the fonts sent, and keeps them for generates that only name their key', async () => {
        await init()
        await generate({fonts_key: 'k1', fonts: FONTS})
        expect(build_schema).toHaveBeenLastCalledWith(FORM,
            [{family: 'Upload', style: 'sans'}], undefined)
        expect(last_generate()['custom_fonts']).toEqual(FONTS[0]!.files)

        // The same byte arrays again, which is what bookcover keys its font cache on
        await generate({fonts_key: 'k1'})
        expect(last_generate()['custom_fonts']).toEqual(FONTS[0]!.files)
        expect((last_generate()['custom_fonts'] as Uint8Array[])[0]).toBe(FONTS[0]!.files[0])
    })

    it('refuses a generate naming fonts it never received', async () => {
        await init()
        await generate({fonts_key: 'k1', fonts: FONTS})
        expect(await generate({fonts_key: 'k2'}))
            .toMatchObject({ok: false, error: 'Cover fonts out of sync with the client'})
        expect(generator.generate).toHaveBeenCalledTimes(1)
    })

    it('adopts a generate\'s fonts even when that generate fails', async () => {
        // Before init the generate fails, but the client counts its fonts as delivered
        expect(await generate({fonts_key: 'k1', fonts: FONTS})).toMatchObject({ok: false})
        await init()
        expect(await generate({fonts_key: 'k1'})).toMatchObject({ok: true})
        expect(last_generate()['custom_fonts']).toEqual(FONTS[0]!.files)
    })

})
