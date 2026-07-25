
// Fetch and cache passage image bytes for embedding in a Typst compile. Raster bytes can't be
// inlined as Typst source text (unlike the SVG icons/frames in content_title.ts), so they're
// handed to the compiler out-of-band as a virtual file (see TypstRequest.assets) and referenced
// by filename from generated source. `url` is always a plain fetchable address regardless of
// whether the image came from an external service or a user upload (see ContentPassageImage),
// so this relies only on the global fetch — same as icon_cache.ts — and needs no Firebase/
// Storage awareness. Used by both the in-browser and Node (server) pipelines.

import type {ContentPassageImage, TypstPassageImage} from './types.js'


// Content-type -> file extension, for the virtual filename Typst references
const MIME_EXT:Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
}


// Module-level in-memory cache: image URL -> resolved bytes/filename (id-independent, so the
// same image reused across passages/recompiles only downloads once)
const image_cache = new Map<string, Promise<{bytes:Uint8Array, ext:string}>>()


// Fetch an image's bytes + extension, cached by URL
async function fetch_image_bytes(url:string):Promise<{bytes:Uint8Array, ext:string}> {
    const cached = image_cache.get(url)
    if (cached) {
        return cached
    }
    const promise = (async () => {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(
                `Failed to fetch image "${url}": ${response.status} ${response.statusText}`)
        }
        const content_type = response.headers.get('content-type')?.split(';')[0]?.trim()
        const url_ext = url.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase()
        const ext = (content_type && MIME_EXT[content_type])
            || (url_ext && Object.values(MIME_EXT).includes(url_ext) ? url_ext : null)
            || 'jpg'
        const bytes = new Uint8Array(await response.arrayBuffer())
        return {bytes, ext}
    })()
    image_cache.set(url, promise)
    // Don't cache failures — a later resolve should retry the download
    promise.catch(() => image_cache.delete(url))
    return promise
}


// Resolve a passage's image config to its Typst-embeddable form (bytes + a stable virtual
// filename keyed off the content item's id, so it never collides with another item's image)
export async function resolve_passage_image(
    image:ContentPassageImage, item_id:string,
):Promise<TypstPassageImage|null> {
    if (!image.url) {
        return null
    }
    const {bytes, ext} = await fetch_image_bytes(image.url)
    return {filename: `passage_img_${item_id}.${ext}`, bytes}
}
