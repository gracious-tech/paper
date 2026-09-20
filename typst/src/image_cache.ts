
// Fetch and cache passage image bytes for embedding in a Typst compile. Raster bytes can't be
// inlined as Typst source text (unlike the SVG icons/frames in content_title.ts), so they're
// handed to the compiler out-of-band as a virtual file (see TypstRequest.assets) and referenced
// by filename from generated source. `url` is always a plain fetchable address regardless of
// whether the image came from an external service or a user upload (see ContentPassageImage),
// so this relies only on the global fetch — same as icon_cache.ts — and needs no Firebase/
// Storage awareness. Used by both the in-browser and Node (server) pipelines.

import {LruCache} from './helpers.js'

import type {ContentPassageImage, TypstPassageImage} from './types.js'


// Content-type -> file extension, for the virtual filename Typst references
const MIME_EXT:Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
}


// Most a single image may weigh before the download is abandoned. Comfortably above any photo
// worth printing, and low enough that a hostile url can't exhaust a compile instance's memory
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024


// Total budget for cached image bytes. Unlike the browser (whose worker is recycled regularly)
// the compile service is a long-lived process compiling arbitrary documents, so this must be
// capped rather than left to grow for the life of the instance
const MAX_CACHE_BYTES = 96 * 1024 * 1024


// Resolved images, keyed by URL (id-independent, so the same image reused across passages/
// recompiles only downloads once), plus the in-flight downloads that haven't resolved yet —
// the cache can only hold a value once its size is known, and dropping the promise would let
// concurrent resolves of the same url each start their own download
const image_cache = new LruCache<{bytes:Uint8Array, ext:string}>(MAX_CACHE_BYTES)
const in_flight = new Map<string, Promise<{bytes:Uint8Array, ext:string}>>()


// Hostnames that never belong to a real image host: loopback, link-local (including the cloud
// metadata address), the private IPv4/IPv6 ranges, and the reserved suffixes that only ever
// name something on the local network. Checked against the literal host in the url, so this
// stops a server-side fetch being pointed at the instance's own network — it can't stop a
// public name that resolves there, which is out of scope here
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])
const LOCAL_SUFFIXES = ['.internal', '.local', '.localhost']
const PRIVATE_HOST_RE =
    /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?(?:::1|fc|fd|fe80))/i


// Whether a url is one a *server-side* compile may fetch: https, and not aimed at the instance's
// own network (see LOCAL_HOSTNAMES/PRIVATE_HOST_RE). `allow_local` lifts both for local
// development, where uploads live on the Storage emulator over plain http.
// The browser needs no such check — it fetches under the page's own origin policy — so this is
// applied where the server accepts a version for compiling (see handle_compile), keeping the
// trust boundary alongside its sibling checks on font and cover-image paths
export function is_fetchable_image_url(url:string, allow_local = false):boolean{
    let parsed:URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    if (allow_local){
        return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    }
    if (parsed.protocol !== 'https:'){
        return false
    }
    const host = parsed.hostname.toLowerCase()
    return !LOCAL_HOSTNAMES.has(host) && !PRIVATE_HOST_RE.test(host)
        && !LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))
}


// Read a response body, abandoning it once it passes `max` bytes. Content-Length is checked
// first where it's given, but it's only a claim — the streamed total is what actually decides
async function read_capped(response:Response, url:string, max:number):Promise<Uint8Array>{
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > max){
        throw new Error(`Image "${url}" is too large (${declared} bytes, max ${max})`)
    }
    const reader = response.body?.getReader()
    if (!reader){
        // No streaming body available — fall back to the whole buffer and check after the fact
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > max){
            throw new Error(`Image "${url}" is too large (${bytes.length} bytes, max ${max})`)
        }
        return bytes
    }
    const chunks:Uint8Array[] = []
    let total = 0
    for (;;){
        const {done, value} = await reader.read()
        if (done){
            break
        }
        total += value.length
        if (total > max){
            await reader.cancel()
            throw new Error(`Image "${url}" is too large (over ${max} bytes)`)
        }
        chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks){
        bytes.set(chunk, offset)
        offset += chunk.length
    }
    return bytes
}


// Fetch an image's bytes + extension, cached by URL
async function fetch_image_bytes(url:string):Promise<{bytes:Uint8Array, ext:string}> {
    const cached = image_cache.get(url)
    if (cached) {
        return cached
    }
    const pending = in_flight.get(url)
    if (pending) {
        return pending
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
        const bytes = await read_capped(response, url, MAX_IMAGE_BYTES)
        return {bytes, ext}
    })()
    in_flight.set(url, promise)
    try {
        const result = await promise
        image_cache.set(url, result, result.bytes.length)
        return result
    } finally {
        // Cleared either way — a failure shouldn't be remembered, a later resolve should retry
        in_flight.delete(url)
    }
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
