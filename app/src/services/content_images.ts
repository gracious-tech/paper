
// User-uploaded passage image support: content-addressed Storage upload (mirrors cover.ts's bg
// image handling) + freeze-time snapshotting so an immutable version never depends on the user's
// mutable image library.

import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'

import {firebase_storage, storage_bucket} from '@/services/firebase'
import {user} from '@/services/auth'
import {hash_bytes} from '@/services/cover'

import type {Blueprint, ContentItem, ContentPassageImage} from '@/services/types'


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
