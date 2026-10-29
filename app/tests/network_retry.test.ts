// Riding out a lost connection mid-compile: a finished PDF or a version ready for the server
// exists only in the tab, so a network failure must be waited out (and said so), while any other
// failure still throws at once so the compile can fall back or fail as before.

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {retry_network, retry_startup} from '@/services/network_retry'
import {version_progress} from '@/services/compile_progress'


// A stand-in for the browser's connectivity: navigator.onLine plus the window's 'online' event
let online = true
let online_listeners:(() => void)[] = []
function go_online():void{
    online = true
    const listeners = online_listeners
    online_listeners = []
    listeners.forEach(listener => listener())
}

beforeEach(() => {
    online = true
    online_listeners = []
    vi.stubGlobal('navigator', {get onLine(){ return online }})
    vi.stubGlobal('addEventListener', (type:string, listener:() => void) => {
        if (type === 'online'){
            online_listeners.push(listener)
        }
    })
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    for (const id of Object.keys(version_progress)){
        delete version_progress[id]
    }
})


// An error the caller classes as a lost connection, and one it doesn't
class Unreachable extends Error {}
const is_network = (error:unknown) => error instanceof Unreachable


describe('retry_network', () => {

    it('throws anything but a lost connection straight away', async () => {
        const attempt = vi.fn(() => Promise.reject(new Error('refused')))
        await expect(retry_network(attempt, is_network, 'v')).rejects.toThrow('refused')
        expect(attempt).toHaveBeenCalledTimes(1)
    })

    it('retries a failure while online after growing gaps, then gives up', async () => {
        const attempt = vi.fn(() => Promise.reject(new Unreachable('blip')))
        const result = retry_network(attempt, is_network, 'v')
        const settled = result.catch((error:unknown) => error)
        await vi.advanceTimersByTimeAsync(2000)
        expect(attempt).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(5000)
        expect(attempt).toHaveBeenCalledTimes(3)
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
        expect(await settled).toBeInstanceOf(Unreachable)
    })

    it('recovers once a retry gets through', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(new Unreachable('blip'))
            .mockResolvedValueOnce('done')
        const result = retry_network(attempt, is_network, 'v')
        await vi.advanceTimersByTimeAsync(2000)
        expect(await result).toBe('done')
    })

    it('waits however long the browser is offline, showing it in the progress', async () => {
        version_progress['v'] = {stage: 'finalize'}
        online = false
        const attempt = vi.fn()
            .mockRejectedValueOnce(new Unreachable('offline'))
            .mockResolvedValueOnce('done')
        const result = retry_network(attempt, is_network, 'v')
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
        expect(attempt).toHaveBeenCalledTimes(1)
        expect(version_progress['v']).toEqual({stage: 'offline'})

        go_online()
        expect(await result).toBe('done')
        expect(version_progress['v']).toEqual({stage: 'finalize'})
    })

    it("doesn't show progress for a version this tab isn't showing", async () => {
        online = false
        const attempt = vi.fn()
            .mockRejectedValueOnce(new Unreachable('offline'))
            .mockResolvedValueOnce('done')
        const result = retry_network(attempt, is_network, 'v')
        await vi.advanceTimersByTimeAsync(0)
        expect('v' in version_progress).toBe(false)
        go_online()
        expect(await result).toBe('done')
        expect('v' in version_progress).toBe(false)
    })
})


describe('retry_startup', () => {

    const network_error = new TypeError('Failed to fetch')
    const is_network = (error:unknown) => error === network_error

    it('tries a step that couldn\'t reach the network twice more, after short gaps', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(network_error)
            .mockRejectedValueOnce(network_error)
            .mockResolvedValue('manifest')
        const result = retry_startup(attempt, is_network)
        await vi.advanceTimersByTimeAsync(999)
        expect(attempt).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(attempt).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(3000)
        expect(await result).toBe('manifest')
        expect(attempt).toHaveBeenCalledTimes(3)
    })

    it('throws the last try\'s failure', async () => {
        const attempt = vi.fn().mockRejectedValue(network_error)
        const result = retry_startup(attempt, is_network).catch((error:unknown) => error)
        await vi.runAllTimersAsync()
        expect(await result).toBe(network_error)
        expect(attempt).toHaveBeenCalledTimes(3)
    })

    it('throws anything else at once', async () => {
        const other = new Error('Bad manifest')
        const attempt = vi.fn().mockRejectedValue(other)
        await expect(retry_startup(attempt, is_network)).rejects.toBe(other)
        expect(attempt).toHaveBeenCalledOnce()
    })

})
