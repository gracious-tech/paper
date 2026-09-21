
// Small shared helpers. The url64 pair carries more weight than it looks: generate_token() mints
// design ids, version ids and share tokens, and those ids *are* the capability to read what they
// name — so the alphabet has to stay URL-safe and the randomness has to come from crypto.

import {describe, it, expect, vi, afterEach} from 'vitest'

import {buffer_to_url64, url64_to_buffer, generate_token, string_to_utf8, debounce,
    format_relative_time} from '@/services/utils'


afterEach(() => {
    vi.useRealTimers()
})


describe('url64 encoding', () => {

    it('round-trips arbitrary bytes', () => {
        const bytes = new Uint8Array([0, 1, 127, 128, 254, 255])
        expect(new Uint8Array(url64_to_buffer(buffer_to_url64(bytes.buffer))))
            .toEqual(bytes)
    })

    it('round-trips every byte value', () => {
        const bytes = new Uint8Array(256).map((_, i) => i)
        expect(new Uint8Array(url64_to_buffer(buffer_to_url64(bytes.buffer))))
            .toEqual(bytes)
    })

    it('round-trips at every length up to a block boundary', () => {
        for (let length = 0; length <= 8; length++){
            const bytes = new Uint8Array(length).map((_, i) => (i * 37) % 256)
            expect(new Uint8Array(url64_to_buffer(buffer_to_url64(bytes.buffer))))
                .toEqual(bytes)
        }
    })

    it('uses no character that needs escaping in a URL', () => {
        // These ids travel in paths and query strings, and index Storage object names
        const bytes = new Uint8Array(3 * 256)
        for (let i = 0; i < bytes.length; i++){
            bytes[i] = i % 256
        }
        expect(buffer_to_url64(bytes.buffer)).toMatch(/^[A-Za-z0-9\-_~]*$/)
    })

    it('never emits the standard base64 characters it replaces', () => {
        const bytes = new Uint8Array([251, 255, 190, 255])
        const encoded = buffer_to_url64(bytes.buffer)
        expect(encoded).not.toContain('+')
        expect(encoded).not.toContain('/')
        expect(encoded).not.toContain('=')
    })

    it('encodes an empty buffer as an empty string', () => {
        expect(buffer_to_url64(new Uint8Array().buffer)).toBe('')
    })
})


describe('generate_token', () => {

    it('produces a url-safe token of the expected length', () => {
        // 15 bytes -> 20 characters, no padding
        expect(generate_token()).toMatch(/^[A-Za-z0-9\-_~]{20}$/)
    })

    it('honours a requested byte length', () => {
        expect(generate_token(3)).toHaveLength(4)
        expect(generate_token(30)).toHaveLength(40)
    })

    it('does not repeat', () => {
        const tokens = new Set(Array.from({length: 500}, () => generate_token()))
        expect(tokens.size).toBe(500)
    })

    it('draws from crypto, not Math.random', () => {
        const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
        generate_token()
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})


describe('string_to_utf8', () => {

    it('encodes ascii one byte per character', () => {
        expect(new Uint8Array(string_to_utf8('abc'))).toEqual(new Uint8Array([97, 98, 99]))
    })

    it('encodes multi-byte characters', () => {
        expect(new Uint8Array(string_to_utf8('é')).length).toBe(2)
        expect(new Uint8Array(string_to_utf8('中')).length).toBe(3)
    })
})


describe('debounce', () => {

    it('calls once after the wait, with the latest arguments', () => {
        vi.useFakeTimers()
        const spy = vi.fn()
        const debounced = debounce(spy, 100) as (value:number) => void
        debounced(1)
        debounced(2)
        debounced(3)
        expect(spy).not.toHaveBeenCalled()
        vi.advanceTimersByTime(100)
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith(3)
    })

    it('defaults to half a second', () => {
        vi.useFakeTimers()
        const spy = vi.fn()
        const debounced = debounce(spy) as () => void
        debounced()
        vi.advanceTimersByTime(499)
        expect(spy).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(spy).toHaveBeenCalledTimes(1)
    })
})


describe('format_relative_time', () => {

    // Locale-dependent wording, so these assert the bucket that was chosen rather than the text

    const ago = (ms:number) => format_relative_time(new Date(Date.now() - ms))

    it('collapses anything under a minute to "now"', () => {
        expect(ago(0)).toBe(ago(30_000))
    })

    it('uses distinct wording per bucket', () => {
        const buckets = [
            ago(0),
            ago(5 * 60_000),
            ago(5 * 3_600_000),
            ago(3 * 86_400_000),
            ago(3 * 7 * 86_400_000),
        ]
        expect(new Set(buckets).size).toBe(buckets.length)
    })

    it('falls back to a plain date once relative counting stops being useful', () => {
        const old = ago(400 * 86_400_000)
        expect(old).not.toContain('ago')
        expect(old.length).toBeGreaterThan(0)
    })
})
