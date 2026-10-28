
// Where a desktop's preview comes from (desktop_preview in preview.ts). Its browser makes it,
// unless that's slow, when the server races it; a desktop the server keeps beating is switched to
// the server, and a switched one tries its browser again every so often. What's under test is
// that orchestration: who gets asked, whose preview is shown, and what it does to the device's
// mode. The compiles themselves are stand-ins whose timing each test controls, and
// compile_mode.ts is real, against a stand-in localStorage

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {set_blue} from './stubs/state'
import {make_blueprint} from './helpers/blueprint'

import type {Preview} from '@/services/preview'


// The browser's window compile and the server's preview, controlled per test
const compile_window = vi.hoisted(() => vi.fn())
const request_server = vi.hoisted(() => vi.fn())
const generator = vi.hoisted(() => ({abandon: vi.fn(), release_memory: vi.fn()}))
const cover = vi.hoisted(() => ({render: vi.fn(), remember: vi.fn()}))

vi.mock('@/services/page_estimate', () => ({
    compile_preview_window: compile_window,
    render_signature: () => 'signature',
    set_page_estimate: vi.fn(),
}))
vi.mock('@/services/server_preview', () => ({request_server_preview: request_server}))
vi.mock('@/services/typst', () => ({typst_generator: {value: generator}}))
vi.mock('@/services/cover', () => ({
    render_cover_panels: cover.render,
    remember_previewed_cover: cover.remember,
    cover_json: () => 'cover_json',
}))
vi.mock('@/services/errors', () => ({report_error: vi.fn()}))
vi.mock('@/services/compile_progress', () => ({claim_compile_turn: async () => () => {}}))

// What compile_mode.ts records a change of mode through, and that this is a desktop
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), addDoc: vi.fn(async () => undefined), serverTimestamp: vi.fn(),
    Timestamp: {fromMillis: (ms:number) => ms},
}))
vi.mock('@/services/firebase', () => ({firestore: {}}))
vi.mock('@/services/auth', () => ({user: {value: null}}))
vi.mock('@/services/display', () => ({is_mobile_now: () => false}))
vi.mock('@/services/designs', () => ({current_design_id: {value: 'design_1'}}))


// This browser's localStorage
let storage:Map<string, string>


// A promise and the means to settle it from the test
function deferred<T>(){
    let resolve!:(value:T) => void
    let reject!:(error:unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return {promise, resolve, reject}
}


// A finished window compile, as compile_preview_window returns one
function window_result(){
    return {pages: [{inner: 'browser', x: 0, width: 100, height: 140}], share_url: undefined,
        page_estimate: 2, signature: 'signature', truncation: {truncated: false,
            dropped_before: false, dropped_after: false}}
}


// The server's preview, told apart from the browser's by its page
const SERVER_PREVIEW:Preview = {pages: ['server'], covers: [],
    truncated: false, dropped_before: false, dropped_after: false}


// A browser compile that starts straight away and finishes when the test says
function browser_compile(){
    const done = deferred<ReturnType<typeof window_result>>()
    compile_window.mockImplementationOnce(async (_generator, _section, _limit, _progress,
            options:{on_compile?:() => void}) => {
        options.on_compile?.()
        return await done.promise
    })
    return done
}


async function load(stored:Record<string, string> = {}){
    // Fresh modules, as a page load finds them with the given storage
    vi.resetModules()
    storage = new Map(Object.entries(stored))
    vi.stubGlobal('localStorage', {
        getItem: (key:string) => storage.get(key) ?? null,
        setItem: (key:string, value:string) => storage.set(key, value),
        removeItem: (key:string) => storage.delete(key),
    })
    vi.stubGlobal('addEventListener', () => undefined)
    return {
        preview: await import('@/services/preview'),
        mode: await import('@/services/compile_mode'),
        // The open design the fresh modules read (not the one imported above)
        state: await import('./stubs/state'),
    }
}


// A wraparound cover as the renderer makes one: a viewBox the desktop's crop can cut down
const WRAPAROUND = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"'
    + ' viewBox="0 0 900 600"><rect width="900" height="600"/></svg>'


// Whether a preview is the browser's
function from_browser(preview:Preview):boolean{
    return preview.pages[0]!.includes('browser')
}


beforeEach(() => {
    vi.useFakeTimers()
    compile_window.mockReset()
    request_server.mockReset().mockResolvedValue(SERVER_PREVIEW)
    generator.abandon.mockReset()
    generator.release_memory.mockReset()
    cover.render.mockReset().mockResolvedValue(
        {front: '<svg>front</svg>', back: '<svg>back</svg>', wraparound: WRAPAROUND})
    cover.remember.mockReset()
    set_blue({cover: null})
})

afterEach(() => {
    vi.useRealTimers()
})


describe('desktop_preview', () => {

    it('shows the browser\'s preview when it keeps up, asking the server nothing', async () => {
        const {preview} = await load({compile_strikes: '2'})
        const browser = browser_compile()
        const result = preview.desktop_preview('start', () => {})
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        expect(request_server).not.toHaveBeenCalled()
        // Keeping up wipes the strikes
        expect(storage.has('compile_strikes')).toBe(false)
    })

    it('has the server race a slow browser, showing whichever is first', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        const result = preview.desktop_preview('end', () => {})

        // Nothing asked of the server until the compile has run 10s
        await vi.advanceTimersByTimeAsync(9_000)
        expect(request_server).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1_000)
        expect(request_server).toHaveBeenCalledWith('desktop', 'end', expect.any(Function))

        // The server wins: the browser's compile is thrown away, and it's a strike
        expect(from_browser(await result)).toBe(false)
        expect(generator.abandon).toHaveBeenCalled()
        expect(storage.get('compile_strikes')).toBe('1')
        browser.reject(new Error('abandoned'))
    })

    it('counts nothing against a slow browser that still beats the server', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        const server = deferred<Preview>()
        request_server.mockReturnValueOnce(server.promise)
        const result = preview.desktop_preview('start', () => {})
        await vi.advanceTimersByTimeAsync(10_000)
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        expect(storage.has('compile_strikes')).toBe(false)
        expect(generator.abandon).not.toHaveBeenCalled()
        server.resolve(SERVER_PREVIEW)
    })

    it('switches the desktop once the server has won three races running', async () => {
        const {preview, mode} = await load({compile_strikes: '2'})
        browser_compile()
        const result = preview.desktop_preview('start', () => {})
        await vi.advanceTimersByTimeAsync(10_000)
        await result
        expect(mode.compiles_on_server()).toBe(true)
        expect(storage.get('compile_on_server')).toBe('provisional')
    })

    it('has the server make it when the browser fails, switching for lack of memory', async () => {
        const {preview, mode} = await load()
        const {BrowserMemoryError} = mode
        compile_window.mockRejectedValueOnce(new BrowserMemoryError('trap'))
        expect(from_browser(await preview.desktop_preview('start', () => {}))).toBe(false)
        expect(mode.compiles_on_server()).toBe(true)
    })

    it('asks the server for nothing once the preview is no longer wanted', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        let wanted = true
        const result = preview.desktop_preview('start', () => {}, () => wanted)
        wanted = false
        await vi.advanceTimersByTimeAsync(10_000)
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        expect(request_server).not.toHaveBeenCalled()
    })

    it('in server mode, has the server make it, and every 20th the browser too', async () => {
        const {preview, mode} = await load()
        mode.switch_to_server('slow')
        for (let i = 0; i < 19; i++){
            expect(from_browser(await preview.desktop_preview('start', () => {}))).toBe(false)
        }
        expect(compile_window).not.toHaveBeenCalled()

        // The 20th: the browser keeps up, so the desktop compiles there again
        const browser = browser_compile()
        const server = deferred<Preview>()
        request_server.mockReturnValueOnce(server.promise)
        const result = preview.desktop_preview('start', () => {})
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(mode.compiles_on_server()).toBe(false)
        server.resolve(SERVER_PREVIEW)
    })
})


describe('desktop_preview, when the preview is superseded or both fail', () => {

    it('throws the browser\'s failure rather than asking the server for a stale preview', async () => {
        const {preview} = await load()
        compile_window.mockRejectedValueOnce(new Error('bad typst'))
        await expect(preview.desktop_preview('start', () => {}, () => false))
            .rejects.toThrow('bad typst')
        expect(request_server).not.toHaveBeenCalled()
    })

    it('waits out a slow browser instead of racing once the preview isn\'t wanted', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        let wanted = true
        const result = preview.desktop_preview('start', () => {}, () => wanted)
        await vi.advanceTimersByTimeAsync(9_000)
        wanted = false
        await vi.advanceTimersByTimeAsync(1_000)
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        expect(request_server).not.toHaveBeenCalled()
    })

    it('shows the server\'s failure when neither the browser nor the server finishes', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        request_server.mockRejectedValueOnce(new Error('server failed'))
        const result = preview.desktop_preview('start', () => {})
        const caught = result.catch((error:unknown) => error)
        await vi.advanceTimersByTimeAsync(10_000)
        browser.reject(new Error('browser failed'))
        expect(await caught).toEqual(new Error('server failed'))
    })

})


describe('phone_preview', () => {

    it('shows the browser\'s preview, counting it as running until shown for a while', async () => {
        const {preview} = await load()
        const browser = browser_compile()
        const result = preview.phone_preview(() => {}, () => {})
        expect(storage.has('compile_in_flight')).toBe(true)
        browser.resolve(window_result())
        expect(from_browser(await result)).toBe(true)
        expect(request_server).not.toHaveBeenCalled()
        // Decoding the shown pages is as heavy as compiling them, so the marker stays a while
        expect(storage.has('compile_in_flight')).toBe(true)
        await vi.advanceTimersByTimeAsync(15_000)
        expect(storage.has('compile_in_flight')).toBe(false)
    })

    it('leads with the front and back covers, freeing the compiler before rendering them', async () => {
        const {preview, state} = await load()
        state.set_blue({cover: {} as never})
        const browser = browser_compile()
        const result = preview.phone_preview(() => {}, () => {})
        browser.resolve(window_result())
        expect((await result).covers).toEqual(['<svg>front</svg>', '<svg>back</svg>'])
        expect(generator.release_memory).toHaveBeenCalled()
        // Only a desktop's whole wraparound is remembered for the cover editor
        expect(cover.remember).not.toHaveBeenCalled()
    })

    it('has the server make it when slow, switching the phone and saying why', async () => {
        const {preview, mode} = await load()
        compile_window.mockRejectedValueOnce(new mode.SlowCompileError('slow'))
        const on_slow = vi.fn()
        expect(from_browser(await preview.phone_preview(() => {}, on_slow))).toBe(false)
        expect(on_slow).toHaveBeenCalled()
        expect(mode.compiles_on_server()).toBe(true)
        expect(storage.has('compile_in_flight')).toBe(false)
    })

    it('has the server make it after an error that isn\'t the phone\'s, without switching', async () => {
        const {preview, mode} = await load()
        compile_window.mockRejectedValueOnce(new Error('bad typst'))
        const on_slow = vi.fn()
        expect(from_browser(await preview.phone_preview(() => {}, on_slow))).toBe(false)
        expect(on_slow).not.toHaveBeenCalled()
        expect(mode.compiles_on_server()).toBe(false)
    })

    it('goes straight to the server once the phone compiles there', async () => {
        const {preview, mode} = await load()
        mode.switch_to_server('memory')
        expect(from_browser(await preview.phone_preview(() => {}, () => {}))).toBe(false)
        expect(compile_window).not.toHaveBeenCalled()
        expect(request_server).toHaveBeenCalledWith('phone', 'start', expect.any(Function))
    })

})


describe('browser_preview covers', () => {

    it('gives a desktop the whole wraparound, cropped, and remembers it for the editor', async () => {
        const {preview, state} = await load()
        state.set_blue({...make_blueprint(), cover: {} as never})
        browser_compile().resolve(window_result())
        const result = await preview.browser_preview(generator as never, 'desktop', 'start')
        expect(result.covers).toHaveLength(1)
        expect(result.covers[0]).toContain('<svg')
        expect(cover.remember).toHaveBeenCalledWith('design_1', 'cover_json', result.covers[0])
    })

    it('leaves the cover out of a window that doesn\'t start at the book\'s start', async () => {
        const {preview, state} = await load()
        state.set_blue({cover: {} as never})
        const window = window_result()
        window.truncation = {truncated: true, dropped_before: true, dropped_after: false}
        browser_compile().resolve(window)
        const result = await preview.browser_preview(generator as never, 'desktop', 'end')
        expect(result.covers).toEqual([])
        expect(cover.render).not.toHaveBeenCalled()
    })

})
