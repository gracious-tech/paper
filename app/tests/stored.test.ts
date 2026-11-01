// Reading and writing localStorage without ever throwing (stored.ts): as normal where it works,
// and as if nothing were stored where it's missing (an Android WebView with DOM storage off gives
// a null localStorage) or refuses (private modes, a full quota)

import {describe, it, expect, afterEach, vi} from 'vitest'

import {read_stored, write_stored} from '@/services/stored'


afterEach(() => {
    vi.unstubAllGlobals()
})


describe('stored values', () => {

    it('reads, writes and removes keys where storage works', () => {
        const storage = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key:string) => storage.get(key) ?? null,
            setItem: (key:string, value:string) => storage.set(key, value),
            removeItem: (key:string) => storage.delete(key),
        })
        write_stored('country', 'KE')
        expect(read_stored('country')).toBe('KE')
        write_stored('country', null)
        expect(read_stored('country')).toBe(null)
    })

    it('reads nothing and writes nowhere without storage', () => {
        vi.stubGlobal('localStorage', null)
        expect(read_stored('country')).toBe(null)
        expect(() => write_stored('country', 'KE')).not.toThrow()
        expect(() => write_stored('country', null)).not.toThrow()
    })

    it('reads nothing and writes nowhere when storage refuses', () => {
        const refuse = () => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        }
        vi.stubGlobal('localStorage', {getItem: refuse, setItem: refuse, removeItem: refuse})
        expect(read_stored('country')).toBe(null)
        expect(() => write_stored('country', 'KE')).not.toThrow()
    })

})
