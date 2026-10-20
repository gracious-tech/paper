
import {describe, it, expect} from 'vitest'

import {is_fetchable_image_url, sniff_image_mime} from '../src/image_cache.js'


describe('sniff_image_mime', () => {

    // Leading bytes of each format, padded out past the 12 bytes WebP needs
    const bytes = (...head:number[]) => new Uint8Array([...head, ...new Array(16).fill(0)])

    it('names each raster format by its magic number', () => {
        expect(sniff_image_mime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
        expect(sniff_image_mime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('image/png')
        expect(sniff_image_mime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
        // RIFF, a 4-byte size, then WEBP — the case seen stored under a `.jpg` name
        expect(sniff_image_mime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)))
            .toBe('image/webp')
    })

    it('returns null for anything else, including other RIFF formats', () => {
        // RIFF....WAVE
        expect(sniff_image_mime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)))
            .toBe(null)
        expect(sniff_image_mime(new TextEncoder().encode('<svg xmlns=""/>'))).toBe(null)
        expect(sniff_image_mime(new Uint8Array())).toBe(null)
    })

})


describe('is_fetchable_image_url', () => {

    it('accepts ordinary https image urls', () => {
        expect(is_fetchable_image_url('https://example.com/photo.jpg')).toBe(true)
        expect(is_fetchable_image_url(
            'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media')).toBe(true)
    })

    it('rejects anything that is not https', () => {
        expect(is_fetchable_image_url('http://example.com/photo.jpg')).toBe(false)
        expect(is_fetchable_image_url('file:///etc/passwd')).toBe(false)
        expect(is_fetchable_image_url('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
        expect(is_fetchable_image_url('not a url at all')).toBe(false)
    })

    it('rejects addresses on the compile instance\'s own network', () => {
        // The cloud metadata service and the private ranges around it
        expect(is_fetchable_image_url('https://169.254.169.254/computeMetadata/v1/')).toBe(false)
        expect(is_fetchable_image_url('https://metadata.google.internal/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://localhost/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://127.0.0.1:8080/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://10.1.2.3/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://192.168.0.1/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://172.16.0.1/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://172.31.255.1/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://[::1]/x.jpg')).toBe(false)
        expect(is_fetchable_image_url('https://[fd00::1]/x.jpg')).toBe(false)
    })

    it('does not mistake a public address for a private one', () => {
        // Adjacent to the private ranges but outside them
        expect(is_fetchable_image_url('https://172.15.0.1/x.jpg')).toBe(true)
        expect(is_fetchable_image_url('https://172.32.0.1/x.jpg')).toBe(true)
        expect(is_fetchable_image_url('https://11.0.0.1/x.jpg')).toBe(true)
        // Only the reserved local suffixes are blocked, not any name containing them
        expect(is_fetchable_image_url('https://internal.example.com/x.jpg')).toBe(true)
    })

    it('allows the local emulator only when development is opted into', () => {
        expect(is_fetchable_image_url('http://localhost:9199/v0/b/x/o/y', true)).toBe(true)
        expect(is_fetchable_image_url('http://localhost:9199/v0/b/x/o/y')).toBe(false)
    })

})
