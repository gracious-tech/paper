
// Whether a device compiles in its browser or on the server (compile_mode.ts). The switch is the
// device's alone and outlives the page, so what's under test is which failures make it, that it
// stays provisional until the server has done a job, and what it leaves in storage for the next
// page load to read. Firebase is mocked: the mode-change rows are best-effort telemetry

import {describe, it, expect, beforeEach, vi} from 'vitest'


// What the module records a mode change through
const add_doc = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => 'compile_stats'),
    addDoc: add_doc,
    serverTimestamp: vi.fn(() => 'now'),
    Timestamp: {fromMillis: (ms:number) => ms},
}))
vi.mock('@/services/firebase', () => ({firestore: {}}))
vi.mock('@/services/auth', async () => {
    const {ref} = await import('vue')
    return {user: ref({uid: 'uid_owner'})}
})
// What a crash is reported through
const report_error = vi.hoisted(() => vi.fn(() => ''))
vi.mock('@/services/errors', () => ({report_error}))
// Whether the device is a phone, per test
const mobile = vi.hoisted(() => ({value: true}))
vi.mock('@/services/display', () => ({is_mobile_now: () => mobile.value}))


// This browser's localStorage, and the page events the module listens to
let storage:Map<string, string>
let listeners:Record<string, () => void>


// User agents: a current iPhone's Safari (whose OS token iOS 26 freezes at 18_x), and Chrome on
// a desktop
const IPHONE_NEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15'
    + ' (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1'
const IPHONE_OLD = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_8 like Mac OS X) AppleWebKit/605.1.15'
    + ' (KHTML, like Gecko) Version/15.6.8 Mobile/15E148 Safari/604.1'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' Chrome/155.0.0.0 Safari/537.36'


async function load(stored:Record<string, string> = {}, user_agent = DESKTOP){
    // A fresh compile_mode.ts, as a page load finds it with the given storage and browser
    vi.resetModules()
    vi.stubGlobal('navigator', {userAgent: user_agent})
    storage = new Map(Object.entries(stored))
    listeners = {}
    vi.stubGlobal('localStorage', {
        getItem: (key:string) => storage.get(key) ?? null,
        setItem: (key:string, value:string) => storage.set(key, value),
        removeItem: (key:string) => storage.delete(key),
    })
    vi.stubGlobal('addEventListener', (type:string, listener:() => void) => {
        listeners[type] = listener
    })
    return await import('@/services/compile_mode')
}


beforeEach(() => {
    add_doc.mockClear()
    report_error.mockClear()
    mobile.value = true
})


describe('is_device_failure', () => {

    it('counts running out of memory and taking too long, nothing else', async () => {
        const mode = await load()
        expect(mode.is_device_failure(new mode.BrowserMemoryError('trap'))).toBe(true)
        expect(mode.is_device_failure(new mode.SlowCompileError('slow'))).toBe(true)
        // An error in the generated Typst, or a lost connection, would fail on the server too
        expect(mode.is_device_failure(new Error('unknown variable: foo'))).toBe(false)
        expect(mode.is_device_failure(new TypeError('Failed to fetch'))).toBe(false)
    })
})


describe('switch_to_server', () => {

    it('switches provisionally, for this page and the next', async () => {
        const mode = await load()
        expect(mode.compiles_on_server()).toBe(false)

        mode.switch_to_server('slow')

        expect(mode.compiles_on_server()).toBe(true)
        expect(mode.switch_provisional()).toBe(true)
        expect(storage.get('compile_on_server')).toBe('provisional')
        expect(add_doc).toHaveBeenCalledWith('compile_stats', expect.objectContaining(
            {kind: 'compile_mode', reason: 'slow', owner: 'uid_owner'}))

        const next = await load(Object.fromEntries(storage))
        expect(next.compiles_on_server()).toBe(true)
        expect(next.switch_provisional()).toBe(true)
    })

    it('can switch for this page alone, recording nothing about the device', async () => {
        const mode = await load()
        mode.use_server_this_session()
        expect(mode.compiles_on_server()).toBe(true)
        expect(mode.switch_provisional()).toBe(false)
        expect(storage.size).toBe(0)
        expect(add_doc).not.toHaveBeenCalled()
        expect((await load()).compiles_on_server()).toBe(false)
    })

    it('does nothing more for a device already switched', async () => {
        const mode = await load({compile_on_server: '1'})
        mode.switch_to_server('memory')
        expect(mode.switch_provisional()).toBe(false)
        expect(add_doc).not.toHaveBeenCalled()
    })
})


describe('old iOS devices', () => {

    it('tells old iOS apart by Safari\'s version, or the OS token where there\'s none', async () => {
        const {is_old_ios} = await load()
        expect(is_old_ios(IPHONE_OLD)).toBe(true)
        expect(is_old_ios(IPHONE_NEW)).toBe(false)
        expect(is_old_ios(DESKTOP)).toBe(false)
        // An iPad's Safari, and in-app browsers (Facebook, Chrome) with no Version/ at all
        expect(is_old_ios('Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15'
            + ' (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1')).toBe(true)
        expect(is_old_ios('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_12 like Mac OS X)'
            + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20H364 [FBAN/FBIOS;FBAV/584.0]'))
            .toBe(true)
        expect(is_old_ios('Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X)'
            + ' AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1'))
            .toBe(false)
    })

    it('start on the server, without recording a switch', async () => {
        const mode = await load({}, IPHONE_OLD)
        expect(mode.compiles_on_server()).toBe(true)
        expect(mode.switch_provisional()).toBe(false)
        expect(storage.size).toBe(0)
        expect(add_doc).not.toHaveBeenCalled()
        expect((await load({}, IPHONE_NEW)).compiles_on_server()).toBe(false)
    })

    it('stay on the server, re-check or not', async () => {
        mobile.value = false
        const mode = await load({compile_on_server: 'provisional',
            compile_recheck: JSON.stringify({left: 1, interval: 20})}, IPHONE_OLD)
        expect(mode.recheck_due()).toBe(false)
        mode.settle_server_mode(false)
        expect(mode.compiles_on_server()).toBe(true)
    })

})


describe('settle_server_mode', () => {

    it('confirms the switch once the server manages the job', async () => {
        const mode = await load()
        mode.switch_to_server('memory')
        mode.settle_server_mode(true)
        expect(mode.compiles_on_server()).toBe(true)
        expect(mode.switch_provisional()).toBe(false)
        expect(storage.get('compile_on_server')).toBe('1')
    })

    it('switches back when the server fails too', async () => {
        const mode = await load()
        mode.switch_to_server('slow')
        mode.settle_server_mode(false)
        expect(mode.compiles_on_server()).toBe(false)
        expect([...storage.keys()]).toEqual([])
        expect(add_doc).toHaveBeenLastCalledWith('compile_stats', expect.objectContaining(
            {kind: 'compile_mode_reverted'}))
    })

    it('leaves a confirmed switch alone, whatever one job does', async () => {
        const mode = await load({compile_on_server: '1'})
        mode.settle_server_mode(false)
        expect(mode.compiles_on_server()).toBe(true)
        expect(storage.get('compile_on_server')).toBe('1')
    })
})


describe('a desktop\'s strikes', () => {

    beforeEach(() => {
        mobile.value = false
    })

    it('switch it after the server beats its browser three times running', async () => {
        const mode = await load()
        mode.strike('slow')
        mode.strike('slow')
        expect(mode.compiles_on_server()).toBe(false)
        mode.strike('slow')
        expect(mode.compiles_on_server()).toBe(true)
        expect(add_doc).toHaveBeenCalledWith('compile_stats', expect.objectContaining(
            {kind: 'compile_mode', reason: 'slow', mobile: false}))
    })

    it('are wiped by a preview the browser finishes in time, and outlast the page', async () => {
        let mode = await load()
        mode.strike('slow')
        mode.strike('slow')
        mode.clear_strikes()
        mode.strike('slow')
        expect(mode.compiles_on_server()).toBe(false)
        mode = await load(Object.fromEntries(storage))
        mode.strike('slow')
        mode.strike('slow')
        expect(mode.compiles_on_server()).toBe(true)
    })

    it('count a dead tab double, so it takes two to switch', async () => {
        let mode = await load({compile_in_flight: '1700000000000'})
        mode.check_crashed_compile()
        expect(mode.compiles_on_server()).toBe(false)
        mode = await load({...Object.fromEntries(storage), compile_in_flight: '1700000000000'})
        mode.check_crashed_compile()
        expect(mode.compiles_on_server()).toBe(true)
    })
})


describe('a switched desktop\'s re-checks', () => {

    beforeEach(() => {
        mobile.value = false
    })

    // How many server previews it takes until a re-check is due
    function previews_until_due(mode:Awaited<ReturnType<typeof load>>):number{
        for (let count = 1; count <= 1000; count++){
            if (mode.recheck_due()){
                return count
            }
        }
        return Infinity
    }

    it('come every 20th preview, then twice as far apart each time the browser fails', async () => {
        const mode = await load()
        mode.switch_to_server('slow')
        expect(previews_until_due(mode)).toBe(20)
        mode.recheck_failed()
        expect(previews_until_due(mode)).toBe(40)
        mode.recheck_failed()
        mode.recheck_failed()
        mode.recheck_failed()
        mode.recheck_failed()
        // Capped, so a laptop that's merely having a bad month isn't written off
        expect(previews_until_due(mode)).toBe(160)
    })

    it('switch it back once the browser keeps up, with a clean slate', async () => {
        const mode = await load()
        mode.switch_to_server('slow')
        mode.recheck_passed()
        expect(mode.compiles_on_server()).toBe(false)
        expect([...storage.keys()]).toEqual([])
        expect(add_doc).toHaveBeenLastCalledWith('compile_stats', expect.objectContaining(
            {kind: 'compile_mode_reverted', reason: 'recheck'}))
    })

    it('never happen on a phone, whose browser may lose the tab', async () => {
        mobile.value = true
        const mode = await load()
        mode.switch_to_server('memory')
        expect(previews_until_due(mode)).toBe(Infinity)
    })

    it('never happen on a device compiling in its browser', async () => {
        const mode = await load()
        expect(mode.recheck_due()).toBe(false)
    })
})


describe('check_crashed_compile', () => {

    it('switches a phone whose last page died mid-compile, reporting where', async () => {
        const marker = JSON.stringify({at: Date.now() - 5000, stages: ['build', 'compile']})
        const mode = await load({compile_in_flight: marker})
        mode.check_crashed_compile()
        expect(mode.compiles_on_server()).toBe(true)
        expect(storage.has('compile_in_flight')).toBe(false)
        expect(add_doc).toHaveBeenCalledWith('compile_stats', expect.objectContaining(
            {reason: 'crash'}))
        expect(report_error).toHaveBeenCalledWith('silent', expect.any(Error), {critical: true,
            context: {stages: 'build>compile', since_marked_ms: expect.any(Number), mobile: 1}})
    })

    it('still switches on a marker left by a build from before stages', async () => {
        const mode = await load({compile_in_flight: '1700000000000'})
        mode.check_crashed_compile()
        expect(mode.compiles_on_server()).toBe(true)
        expect(report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {critical: true, context: {stages: 'unknown', mobile: 1}})
    })

    it('leaves a page that died doing nothing heavy alone', async () => {
        const mode = await load()
        mode.check_crashed_compile()
        expect(mode.compiles_on_server()).toBe(false)
        expect(report_error).not.toHaveBeenCalled()
    })

    it('records the stages running, past the worker\'s own compile', async () => {
        // A build's main-thread work around its compile (the upload) can lose the tab too
        const mode = await load()
        const stages = () => (JSON.parse(storage.get('compile_in_flight')!) as
            {stages:string[]}).stages
        const end_build = mode.begin_browser_job('build')
        let finish = () => {}
        const compile = mode.track_browser_compile(new Promise<void>(resolve => {
            finish = resolve
        }))
        expect(stages()).toEqual(['build', 'compile'])
        finish()
        await compile
        expect(stages()).toEqual(['build'])
        end_build()
        expect(storage.has('compile_in_flight')).toBe(false)
        // Ending twice is harmless (a build ends its job on more than one path)
        mode.begin_browser_job('phone_preview')
        end_build()
        expect(stages()).toEqual(['phone_preview'])
    })

    it('marks a compile as running only while it runs, and not past leaving the page',
            async () => {
        const mode = await load()
        let finish = () => {}
        const compile = mode.track_browser_compile(new Promise<void>(resolve => {
            finish = resolve
        }))
        expect(storage.has('compile_in_flight')).toBe(true)

        // Leaving on purpose isn't a crash
        listeners['pagehide']!()
        expect(storage.has('compile_in_flight')).toBe(false)
        listeners['pageshow']!()
        expect(storage.has('compile_in_flight')).toBe(true)

        finish()
        await compile
        expect(storage.has('compile_in_flight')).toBe(false)
    })
})


describe('within_timeout', () => {

    it('gives up on a compile that takes too long, abandoning it', async () => {
        const mode = await load()
        const abandon = vi.fn()
        await expect(mode.within_timeout(new Promise(() => {}), 10, abandon))
            .rejects.toBeInstanceOf(mode.SlowCompileError)
        expect(abandon).toHaveBeenCalledOnce()
    })

    it('passes a compile that finishes in time straight through', async () => {
        const mode = await load()
        const abandon = vi.fn()
        expect(await mode.within_timeout(Promise.resolve('pdf'), 1000, abandon)).toBe('pdf')
        expect(abandon).not.toHaveBeenCalled()
    })
})
