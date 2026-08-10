
// User-uploaded passage image support: content-addressed Storage upload (mirrors cover.ts's bg
// image handling) + freeze-time snapshotting so an immutable version never depends on the user's
// mutable image library. Also handles painted/torn border styling: the *original* upload is never
// touched, so switching styles never requires re-uploading — a processed variant is derived on
// demand (canvas-masked, see image_frame.ts) and cached content-addressed by the original's hash,
// so repeat renders/style-switches are idempotent and don't reprocess/re-upload unnecessarily.

import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'

import {firebase_storage, storage_bucket} from '@/services/firebase'
import {user} from '@/services/auth'
import {hash_bytes} from '@/services/cover'
import {is_masked_image_style, apply_image_frame} from '@/services/image_frame'

import type {Blueprint, ContentItem, ContentPassageImage, ImageStyle} from '@/services/types'


// Upload types accepted for passage images, and their Storage path extensions
const IMAGE_MIME_EXT:Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
const IMAGE_EXT_MIME = Object.fromEntries(
    Object.entries(IMAGE_MIME_EXT).map(([mime, ext]) => [ext, mime]))


// A public download URL for a Storage object, built deterministically (no getDownloadURL()
// round-trip, so it can be computed *before* the object exists) — needed because a version's
// frozen blueprint must have its final image url at setDoc() time: Firestore rules forbid ever
// patching `blueprint` afterwards, so plan_version_images() can't upload first and fill the url
// in later. Storage rules must allow public `get` for the path (mirrored for the same reason
// browsers can load <img src="..."> tags pointed at public Storage objects with no auth).
function storage_public_url(path:string):string {
    const base = import.meta.env.DEV
        ? 'http://localhost:9199' : 'https://firebasestorage.googleapis.com'
    return `${base}/v0/b/${storage_bucket}/o/${encodeURIComponent(path)}?alt=media`
}


// Upload a passage image to the user's library, content-addressed so re-uploading an unchanged
// image is idempotent. Returns the ContentPassageImage to store on the content item.
export async function upload_passage_image(bytes:Uint8Array, mime:string)
        :Promise<ContentPassageImage> {
    const hash = await hash_bytes(bytes)
    const ext = IMAGE_MIME_EXT[mime] ?? 'jpg'
    const path = `user_content_images/${user.value!.uid}/${hash}.${ext}`
    await uploadBytes(storage_ref(firebase_storage, path), bytes, {contentType: mime})
    return {source: 'upload', url: storage_public_url(path), path, hash}
}


// In-memory cache of resolved styled variants, keyed by `${style}:${variant}:${original hash/
// url}` — so repeat preview recompiles (which re-run on every edit) don't re-fetch/re-process/
// re-upload an unchanged image. Session-lifetime only; the content-addressed Storage path (below)
// is what makes this idempotent across sessions too.
const styled_cache = new Map<string, Promise<ContentPassageImage>>()

// Resolve a passage image to the variant that should actually be embedded for a given
// image_style: unchanged for plain styles (padded/borderless — no processing needed), or a
// canvas-masked copy for painted/torn. `variant` picks the mask's rotation/flip (see
// image_frame.ts) — the masked copy is uploaded to its own Storage prefix, content-addressed by
// the *original* image's hash + style + variant, so switching styles back and forth only ever
// (re)processes an image once per style, never the original.
async function get_styled_passage_image(image:ContentPassageImage, style:ImageStyle, variant:number)
        :Promise<ContentPassageImage> {
    if (!is_masked_image_style(style) || !image.url) {
        return image
    }
    const cache_key = `${style}:${variant}:${image.hash ?? image.url}`
    let cached = styled_cache.get(cache_key)
    if (!cached) {
        cached = process_styled_passage_image(image, style, variant)
        styled_cache.set(cache_key, cached)
        // Don't cache failures — a later resolve should retry
        cached.catch(() => styled_cache.delete(cache_key))
    }
    return cached
}

// Fetch the original, apply the frame mask, and upload the result
async function process_styled_passage_image(
    image:ContentPassageImage, style:ImageStyle, variant:number,
):Promise<ContentPassageImage> {
    const response = await fetch(image.url!)
    if (!response.ok) {
        throw new Error(`Failed to fetch image "${image.url}": ${response.status}`)
    }
    const source_bytes = new Uint8Array(await response.arrayBuffer())
    const source_hash = image.hash ?? await hash_bytes(source_bytes)
    const styled_blob = await apply_image_frame(new Blob([source_bytes]), style, variant)
    const styled_bytes = new Uint8Array(await styled_blob.arrayBuffer())
    const path = `user_content_images/${user.value!.uid}/styled/${style}_v${variant}_${source_hash}.png`
    await uploadBytes(storage_ref(firebase_storage, path), styled_bytes, {contentType: 'image/png'})
    return {source: 'upload', url: storage_public_url(path), path, hash: await hash_bytes(styled_bytes)}
}

// Resolve every passage/picture-story image in a content list to the variant appropriate for the
// given image_style — used both to build the live preview's compile input and to bake the correct
// variant into a version's frozen blueprint at "Create" time (so the server-side compile fallback
// never needs to know about styling at all — it just fetches whatever url ends up in the frozen
// blueprint, exactly like it does for any other image today). Each image gets a stable mask
// rotation/flip variant based on its position among the document's images (not random), so
// regenerating the same document always looks the same, while images generally differ from their
// neighbours — see image_frame.ts's apply_image_frame
export async function resolve_content_for_style(content:ContentItem[], style:ImageStyle)
        :Promise<ContentItem[]> {
    let next_variant = 0
    const take_variant = () => next_variant++
    return Promise.all(content.map(async item => {
        if (item.type === 'passage' && item.image) {
            const variant = take_variant()
            return {...item, image: await get_styled_passage_image(item.image, style, variant)}
        }
        if (item.type === 'picture_story') {
            const slides = await Promise.all(item.slides.map(async slide => {
                if (!slide.image) {
                    return slide
                }
                const variant = take_variant()
                return {...slide, image: await get_styled_passage_image(slide.image, style, variant)}
            }))
            return {...item, slides}
        }
        return item
    }))
}


// Snapshot every uploaded passage image a blueprint's content references into the version's own
// Storage prefix (mirrors plan_version_cover), so regeneration never depends on the user's
// mutable image library. URL-sourced images need no snapshot — the frozen blueprint just keeps
// the same external url. Returns the frozen content list plus the uploads to send once the
// version doc exists (Storage rules require that ordering, like fonts/cover).
export async function plan_version_images(version_id:string, blueprint:Blueprint)
        :Promise<{frozen:ContentItem[], uploads:[string, Uint8Array, string][]}> {
    const uploads:[string, Uint8Array, string][] = []

    // Freeze one uploaded image into the version's prefix, returning its re-pathed config.
    // URL-sourced (or absent) images need no snapshot — they pass through unchanged. path_stem is
    // the destination path without its extension.
    const freeze_image = async (image:ContentPassageImage, path_stem:string)
            :Promise<ContentPassageImage> => {
        if (image.source !== 'upload' || !image.path){
            return image
        }
        const image_ref = storage_ref(firebase_storage, image.path)
        const bytes = new Uint8Array(await getBytes(image_ref))
        const ext = image.path.slice(image.path.lastIndexOf('.') + 1)
        const path = `${path_stem}.${ext}`
        uploads.push([path, bytes, IMAGE_EXT_MIME[ext] ?? 'image/jpeg'])
        return {...image, path, url: storage_public_url(path)}
    }

    const map_item = async (raw_item:ContentItem):Promise<ContentItem> => {
        const item = cloneDeep(toRaw(raw_item))
        // A passage has one image, keyed by the item id
        if (item.type === 'passage' && item.image){
            return {...item,
                image: await freeze_image(item.image, `versions/${version_id}/images/${item.id}`)}
        }
        // A picture story has one image per slide, keyed by item id + slide index
        if (item.type === 'picture_story'){
            item.slides = await Promise.all(item.slides.map(async (slide, i) => {
                if (!slide.image){
                    return slide
                }
                return {...slide, image: await freeze_image(
                    slide.image, `versions/${version_id}/images/${item.id}_${i}`)}
            }))
            return item
        }
        return item
    }
    const frozen = await Promise.all(blueprint.content.map(map_item))
    return {frozen, uploads}
}
