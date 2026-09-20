
// User-uploaded passage image support: content-addressed Storage upload into the open design's
// own prefix (mirrors cover.ts's bg image handling) + freeze-time snapshotting so an immutable
// version never depends on what the live design still references. Also handles painted/torn
// border styling: the *original* upload is never touched, so switching styles never requires
// re-uploading — a processed variant is derived on demand (canvas-masked, see image_frame.ts)
// and cached content-addressed by the original's hash, so repeat renders/style-switches are
// idempotent and don't reprocess/re-upload unnecessarily.

import {ref as storage_ref, uploadBytes} from 'firebase/storage'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'
import {design_assets_prefix, design_cache_prefix, to_version_asset, asset_basename}
    from 'paper-bible-typst'

import {firebase_storage} from '@/services/firebase'
import {hash_bytes} from '@/services/cover'
import {storage_public_url} from '@/services/design_assets'
import {is_masked_image_style, apply_image_frame} from '@/services/image_frame'

import type {AssetCopy} from '@/services/design_assets'
import type {Blueprint, ContentImageRef, ContentItem, ContentPassageImage, ImageStyle}
    from '@/services/types'


// Upload types accepted for passage images, and their Storage path extensions
const IMAGE_MIME_EXT:Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
const IMAGE_EXT_MIME = Object.fromEntries(
    Object.entries(IMAGE_MIME_EXT).map(([mime, ext]) => [ext, mime]))


function mime_for_path(path:string):string {
    // The content type an asset path implies, for re-uploading bytes read back out of Storage
    return IMAGE_EXT_MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/jpeg'
}


// Upload a passage image into the design's own asset prefix, content-addressed so re-uploading
// an unchanged image is idempotent. Returns the ContentPassageImage to store on the content item
export async function upload_passage_image(design_id:string, bytes:Uint8Array, mime:string)
        :Promise<ContentPassageImage> {
    const hash = await hash_bytes(bytes)
    const ext = IMAGE_MIME_EXT[mime] ?? 'jpg'
    const path = `${design_assets_prefix(design_id)}${hash}.${ext}`
    await uploadBytes(storage_ref(firebase_storage, path), bytes, {contentType: mime})
    return {source: 'upload', url: storage_public_url(path), path, hash, original: null}
}


// Strip a passage image down to a bare reference, for storing as another image's `original`
function as_ref(image:ContentPassageImage):ContentImageRef {
    return {source: image.source, url: image.url, path: image.path, hash: image.hash}
}


// Point an image reference at the given design's copy of the same asset. The basename is
// content-addressed and identical in every prefix, so this is a pure path swap — the bytes
// themselves are moved (once) by the copy jobs the callers collect alongside it
function repath_ref<T extends ContentImageRef>(ref:T, prefix:string):T {
    if (ref.source !== 'upload' || !ref.path){
        return ref
    }
    const path = prefix + asset_basename(ref.path)
    return {...ref, path, url: storage_public_url(path)}
}


// Bring a passage image that lives in a version's snapshot prefix back into a live design —
// the inverse of plan_version_images() below, for when a frozen blueprint becomes an editable
// design again (see version_assets.ts). The same basename in the design's own prefix, so
// copying the same image twice reuses the one object
export function plan_image_into_design(image:ContentPassageImage, design_id:string)
        :{image:ContentPassageImage, copies:AssetCopy[]} {
    const prefix = design_assets_prefix(design_id)
    const copies:AssetCopy[] = []
    const move = <T extends ContentImageRef>(ref:T):T => {
        const next = repath_ref(ref, prefix)
        if (next.path && ref.path && next.path !== ref.path){
            copies.push({from: ref.path, to: next.path, content_type: mime_for_path(next.path)})
        }
        return next
    }
    const moved = move(image)
    return {
        image: {...moved, original: image.original ? move(image.original) : null},
        copies,
    }
}


// In-memory cache of resolved styled variants, keyed by `${style}:${variant}:${original hash/
// url}` — so repeat preview recompiles (which re-run on every edit) don't re-fetch/re-process/
// re-upload an unchanged image. Session-lifetime only; the content-addressed Storage path (below)
// is what makes this idempotent across sessions too.
const styled_cache = new Map<string, Promise<ContentPassageImage>>()

// Resolve a passage image to the variant that should actually be embedded for a given
// image_style: unchanged for plain styles (padded/borderless — no processing needed), or a
// canvas-masked copy for painted/torn. `variant` picks the mask's rotation/flip (see
// image_frame.ts) — the masked copy is uploaded to the design's cache prefix, content-addressed
// by the *original* image's hash + style + variant, so switching styles back and forth only ever
// (re)processes an image once per style, never the original.
async function get_styled_passage_image(design_id:string, image:ContentPassageImage,
        style:ImageStyle, variant:number):Promise<ContentPassageImage> {
    if (!is_masked_image_style(style) || !image.url) {
        return image
    }
    const cache_key = `${design_id}:${style}:${variant}:${image.hash ?? image.url}`
    let cached = styled_cache.get(cache_key)
    if (!cached) {
        cached = process_styled_passage_image(design_id, image, style, variant)
        styled_cache.set(cache_key, cached)
        // Don't cache failures — a later resolve should retry
        cached.catch(() => styled_cache.delete(cache_key))
    }
    return cached
}

// Fetch the original, apply the frame mask, and upload the result
async function process_styled_passage_image(
    design_id:string, image:ContentPassageImage, style:ImageStyle, variant:number,
):Promise<ContentPassageImage> {
    const response = await fetch(image.url!)
    if (!response.ok) {
        throw new Error(`Failed to fetch image "${image.url}": ${response.status}`)
    }
    const source_bytes = new Uint8Array(await response.arrayBuffer())
    const source_hash = image.hash ?? await hash_bytes(source_bytes)
    const styled_blob = await apply_image_frame(new Blob([source_bytes]), style, variant)
    const styled_bytes = new Uint8Array(await styled_blob.arrayBuffer())
    // These live in the design's cache prefix rather than beside the real assets, because
    // nothing on the design doc ever names them — a reconcile that sweeps whatever the doc
    // doesn't reference would delete every one. Being regenerable, they're swept by age instead
    const path = `${design_cache_prefix(design_id)}${style}_v${variant}_${source_hash}.png`
    await uploadBytes(storage_ref(firebase_storage, path), styled_bytes, {contentType: 'image/png'})
    // The unmasked source rides along, so the mask is never applied twice: whatever later reads
    // this image back (a duplicate, a restore, a copy) can recover what the user supplied rather
    // than treating the masked copy as the original — see version_assets.ts
    return {source: 'upload', url: storage_public_url(path), path,
        hash: await hash_bytes(styled_bytes), original: image.original ?? as_ref(image)}
}

// Resolve every passage/picture-story image in a content list to the variant appropriate for the
// given image_style — used both to build the live preview's compile input and to bake the correct
// variant into a version's frozen blueprint at "Create" time (so the server-side compile fallback
// never needs to know about styling at all — it just fetches whatever url ends up in the frozen
// blueprint, exactly like it does for any other image today). Each image gets a stable mask
// rotation/flip variant based on its position among the document's images (not random), so
// regenerating the same document always looks the same, while images generally differ from their
// neighbours — see image_frame.ts's apply_image_frame
export async function resolve_content_for_style(design_id:string, content:ContentItem[],
        style:ImageStyle):Promise<ContentItem[]> {
    let next_variant = 0
    const take_variant = () => next_variant++
    return Promise.all(content.map(async item => {
        if (item.type === 'passage' && item.image) {
            const variant = take_variant()
            return {...item,
                image: await get_styled_passage_image(design_id, item.image, style, variant)}
        }
        if (item.type === 'picture_story') {
            const slides = await Promise.all(item.slides.map(async slide => {
                if (!slide.image) {
                    return slide
                }
                const variant = take_variant()
                return {...slide,
                    image: await get_styled_passage_image(design_id, slide.image, style, variant)}
            }))
            return {...item, slides}
        }
        return item
    }))
}


// Snapshot every uploaded passage image a blueprint's content references into the design's
// append-only version_assets prefix (mirrors plan_version_cover), so a version keeps rendering
// exactly as frozen no matter what the live design does afterwards. URL-sourced images need no
// snapshot — the frozen blueprint just keeps the same external url. Purely a path calculation:
// the returned copy jobs are what actually moves any bytes, and most of the time they're all
// already in place (see apply_asset_copies)
export function plan_version_images(design_id:string, blueprint:Blueprint)
        :{frozen:ContentItem[], copies:AssetCopy[]} {
    const copies:AssetCopy[] = []

    // Freeze one uploaded image reference into the version prefix. URL-sourced (or absent)
    // images need no snapshot — they pass through unchanged
    const freeze_ref = <T extends ContentImageRef>(ref:T):T => {
        if (ref.source !== 'upload' || !ref.path){
            return ref
        }
        const path = to_version_asset(ref.path, design_id)
        copies.push({from: ref.path, to: path, content_type: mime_for_path(path)})
        return {...ref, path, url: storage_public_url(path)}
    }

    // Freeze an image and, for a masked (painted/torn) one, the unmasked original beside it.
    // Both are needed: the render uses the masked copy, while turning this version back into an
    // editable design has to recover what the user actually supplied (see version_assets.ts)
    const freeze_image = (image:ContentPassageImage):ContentPassageImage => {
        const frozen = freeze_ref(image)
        if (!image.original){
            return frozen
        }
        return {...frozen, original: freeze_ref(image.original)}
    }

    const map_item = (raw_item:ContentItem):ContentItem => {
        const item = cloneDeep(toRaw(raw_item))
        if (item.type === 'passage' && item.image){
            return {...item, image: freeze_image(item.image)}
        }
        if (item.type === 'picture_story'){
            item.slides = item.slides.map(slide => {
                if (!slide.image){
                    return slide
                }
                return {...slide, image: freeze_image(slide.image)}
            })
            return item
        }
        return item
    }
    return {frozen: blueprint.content.map(map_item), copies}
}
