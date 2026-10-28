
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {is_fetchable_image_url, sniff_image_mime, resolve_passage_image, MAX_IMAGE_BYTES}
    from '../src/image_cache.js'

import type {ContentPassageImage} from '../src/types.js'


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


describe('resolve_passage_image', () => {

    // Leading bytes of each format, as a body a Response can carry
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])
    const UNKNOWN = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    // The cache is module-level, so every test resolves urls no other test uses
    let url_count = 0
    const unique_url = (ext = 'img') => `https://example.com/${++url_count}.${ext}`

    // A passage image pointing at a url
    const image = (url:string|null):ContentPassageImage =>
        ({source: 'url', url, path: null, hash: null, original: null})

    // The stubbed fetch, answering with whatever the test gives it
    let fetch_mock:ReturnType<typeof vi.fn>
    const answer = (make:() => Response) => fetch_mock.mockImplementation(async () => make())

    beforeEach(() => {
        fetch_mock = vi.fn()
        vi.stubGlobal('fetch', fetch_mock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns null without fetching when there is no url', async () => {
        expect(await resolve_passage_image(image(null), 'item')).toBe(null)
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    it('names the file after the content item and the format', async () => {
        answer(() => new Response(PNG))
        const resolved = await resolve_passage_image(image(unique_url()), 'abc')
        expect(resolved?.filename).toBe('passage_img_abc.png')
        expect(resolved?.bytes).toEqual(PNG)
    })

    it('throws on an unsuccessful response, naming the status', async () => {
        answer(() => new Response('gone', {status: 404, statusText: 'Not Found'}))
        await expect(resolve_passage_image(image(unique_url()), 'a'))
            .rejects.toThrow('404 Not Found')
    })

    describe('choosing the extension', () => {

        it('trusts the bytes over the content type and the url', async () => {
            // A WebP saved under a .jpg name and served as one
            answer(() => new Response(WEBP, {headers: {'content-type': 'image/jpeg'}}))
            const resolved = await resolve_passage_image(image(unique_url('jpg')), 'a')
            expect(resolved?.filename).toBe('passage_img_a.webp')
        })

        it('falls back to the content type when the bytes are unrecognised', async () => {
            answer(() => new Response(UNKNOWN,
                {headers: {'content-type': 'image/gif; charset=binary'}}))
            const resolved = await resolve_passage_image(image(unique_url('jpg')), 'a')
            expect(resolved?.filename).toBe('passage_img_a.gif')
        })

        it('then to a known extension in the url, ignoring its query', async () => {
            answer(() => new Response(UNKNOWN, {headers: {'content-type': 'text/plain'}}))
            const resolved = await resolve_passage_image(
                image(`${unique_url('PNG')}?token=x.jpg#y`), 'a')
            expect(resolved?.filename).toBe('passage_img_a.png')
        })

        it('and finally to jpg', async () => {
            answer(() => new Response(UNKNOWN, {headers: {'content-type': 'text/plain'}}))
            const resolved = await resolve_passage_image(image(unique_url('bmp')), 'a')
            expect(resolved?.filename).toBe('passage_img_a.jpg')
        })

    })

    describe('caching', () => {

        it('downloads a url once, whichever item uses it', async () => {
            answer(() => new Response(PNG))
            const url = unique_url()
            await resolve_passage_image(image(url), 'a')
            const second = await resolve_passage_image(image(url), 'b')
            expect(second?.filename).toBe('passage_img_b.png')
            expect(fetch_mock).toHaveBeenCalledTimes(1)
        })

        it('shares one download between concurrent resolves', async () => {
            // Held open until both resolves are waiting on it
            let release:(response:Response) => void = () => {}
            fetch_mock.mockImplementation(() => new Promise<Response>(resolve => {
                release = resolve
            }))
            const url = unique_url()
            const both = Promise.all([
                resolve_passage_image(image(url), 'a'),
                resolve_passage_image(image(url), 'b'),
            ])
            release(new Response(PNG))
            const [first, second] = await both
            expect(first?.bytes).toEqual(PNG)
            expect(second?.bytes).toEqual(PNG)
            expect(fetch_mock).toHaveBeenCalledTimes(1)
        })

        it('does not remember a failure, so a later resolve retries', async () => {
            const url = unique_url()
            fetch_mock.mockResolvedValueOnce(new Response('', {status: 503}))
            await expect(resolve_passage_image(image(url), 'a')).rejects.toThrow('503')
            fetch_mock.mockResolvedValueOnce(new Response(PNG))
            expect((await resolve_passage_image(image(url), 'a'))?.bytes).toEqual(PNG)
            expect(fetch_mock).toHaveBeenCalledTimes(2)
        })

    })

    describe('the size cap', () => {

        it('refuses a declared Content-Length over the cap without reading the body', async () => {
            const body = new ReadableStream<Uint8Array>({
                pull: () => {
                    throw new Error('The body should not be read')
                },
            })
            answer(() => new Response(body,
                {headers: {'content-length': String(MAX_IMAGE_BYTES + 1)}}))
            await expect(resolve_passage_image(image(unique_url()), 'a'))
                .rejects.toThrow(`${MAX_IMAGE_BYTES + 1} bytes, max ${MAX_IMAGE_BYTES}`)
        })

        it('abandons a stream once its total passes the cap, whatever it declared', async () => {
            // Chunks made only as they're pulled, with no Content-Length to go by
            const chunk = new Uint8Array(8 * 1024 * 1024)
            let pulled = 0
            const cancel = vi.fn()
            const body = new ReadableStream<Uint8Array>({
                pull: controller => {
                    pulled += 1
                    controller.enqueue(chunk)
                },
                cancel,
            }, {highWaterMark: 0})
            answer(() => new Response(body))
            await expect(resolve_passage_image(image(unique_url()), 'a'))
                .rejects.toThrow(`over ${MAX_IMAGE_BYTES} bytes`)
            expect(cancel).toHaveBeenCalled()
            // Stopped at the chunk that crossed the cap, not read to the end
            expect(pulled).toBe(Math.floor(MAX_IMAGE_BYTES / chunk.length) + 1)
        })

        it('joins a streamed body back together in order', async () => {
            const parts = [PNG.slice(0, 5), PNG.slice(5, 9), PNG.slice(9)]
            const body = new ReadableStream<Uint8Array>({
                start: controller => {
                    parts.forEach(part => controller.enqueue(part))
                    controller.close()
                },
            })
            answer(() => new Response(body))
            expect((await resolve_passage_image(image(unique_url()), 'a'))?.bytes).toEqual(PNG)
        })

        it('checks the whole buffer when the response has no stream to read', async () => {
            // A body-less response (as some fetch implementations give) reads via arrayBuffer
            const bodiless = (bytes:Uint8Array) => {
                const response = new Response(bytes)
                Object.defineProperty(response, 'body', {value: null})
                return response
            }
            answer(() => bodiless(PNG))
            expect((await resolve_passage_image(image(unique_url()), 'a'))?.bytes).toEqual(PNG)

            const over = new Uint8Array(MAX_IMAGE_BYTES + 1)
            over.set(PNG)
            answer(() => bodiless(over))
            await expect(resolve_passage_image(image(unique_url()), 'a'))
                .rejects.toThrow(`${MAX_IMAGE_BYTES + 1} bytes, max ${MAX_IMAGE_BYTES}`)
        })

    })

})
