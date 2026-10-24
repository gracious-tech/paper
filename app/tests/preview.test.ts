
// Where a desktop's preview comes from (desktop_preview in preview.ts). Its browser makes it,
// unless that's slow, when the server races it; a desktop the server keeps beating is switched to
// the server, and a switched one tries its browser again every so often. What's under test is
// that orchestration: who gets asked, whose preview is shown, and what it does to the device's
// mode. The compiles themselves are stand-ins whose timing each test controls, and
// compile_mode.ts is real, against a stand-in localStorage

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {set_blue} from './stubs/state'

import type {Preview} from '@/services/preview'


// The browser's window compile and the server's preview, controlled per test
const compile_window = vi.hoisted(() => vi.fn())
const request_server = vi.hoisted(() => vi.fn())
const generator = vi.hoisted(() => ({abandon: vi.fn(), release_memory: vi.fn()}))

vi.mock('@/services/page_estimate', () => ({
    compile_preview_window: compile_window,
    render_signature: () => 'signature',
    set_page_estimate: vi.fn(),
}))
vi.mock('@/services/server_preview', () => ({request_server_preview: request_server}))
vi.mock('@/services/typst', () => ({typst_generator: {value: generator}}))
vi.mock('@/services/cover', () => ({render_cover_panels: vi.fn()}))
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
const SERVER_PREVIEW:Preview = {pages: ['server'], front_cover: null, back_cover: null,
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
    }
}


// Whether a preview is the browser's
function from_browser(preview:Preview):boolean{
    return preview.pages[0]!.includes('browser')
}


beforeEach(() => {
    vi.useFakeTimers()
    compile_window.mockReset()
    request_server.mockReset().mockResolvedValue(SERVER_PREVIEW)
    generator.abandon.mockReset()
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
