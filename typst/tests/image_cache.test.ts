
import {describe, it, expect} from 'vitest'

import {is_fetchable_image_url} from '../src/image_cache.js'


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
