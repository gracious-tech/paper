
// Turning a frozen version's snapshotted assets back into assets a live design owns.
//
// Freezing re-paths a design's cover background and passage images into `version_assets/`
// (see plan_version_cover / plan_version_images), an append-only prefix that no design edit
// can touch. So whenever a frozen blueprint becomes a *live* design again — duplicating a
// version into a new design, or restoring one over the design it came from — its references
// have to come back into a `design_assets/` prefix, or editing the new design could never
// reclaim them and deleting the source design would take its pictures with it.
//
// Basenames are content-addressed and identical in both prefixes, so this is a path swap plus
// a one-time byte copy; restoring the same version twice reuses the objects already there.
// The server does the equivalent for "keep own copy", which creates a design under a
// different owner (see server/src/assets.ts).

import {cloneDeep} from 'lodash-es'
import {toRaw} from 'vue'
import {DESIGN_ASSETS} from 'paper-bible-typst'

import {plan_cover_bg_into_design} from '@/services/cover'
import {plan_image_into_design} from '@/services/content_images'
import {apply_asset_copies} from '@/services/design_assets'
import {report_error} from '@/services/errors'

import type {AssetCopy} from '@/services/design_assets'
import type {Blueprint, ContentPassageImage} from '@/services/types'


function collect_images(blueprint:Blueprint):ContentPassageImage[]{
    // Every passage image in the content list, including picture-story slides. Returns the live
    // objects (the blueprint is already a clone) so each can be patched in place
    const images:ContentPassageImage[] = []
    for (const item of blueprint.content){
        if (item.type === 'passage' && item.image){
            images.push(item.image)
        } else if (item.type === 'picture_story'){
            for (const slide of item.slides){
                if (slide.image){
                    images.push(slide.image)
                }
            }
        }
    }
    return images
}


export async function rehydrate_version_blueprint(blueprint:Blueprint, design_id:string)
        :Promise<Blueprint>{
    // Give a frozen version's blueprint the asset references a live design can own and
    // eventually reclaim. Anything already durable — a builtin cover background, an external
    // image url — is left exactly as it is. A snapshot that can no longer be read keeps its
    // original reference rather than being dropped: the design is no worse off than before,
    // and the failure is reported rather than silently changing what the user gets
    const copy = cloneDeep(toRaw(blueprint))
    const copies:AssetCopy[] = []

    const bg = copy.cover?.bg_image
    // Already under this design (restoring a version over its own design, where the freeze
    // found the bytes here in the first place) needs nothing moved
    if (bg?.kind === 'custom' && !bg.path.startsWith(`${DESIGN_ASSETS}/${design_id}/`)){
        const moved = plan_cover_bg_into_design(bg.path, design_id)
        bg.path = moved.path
        copies.push(moved.copy)
    }

    for (const image of collect_images(copy)){
        // A painted/torn image is stored as a pre-masked copy, so the *unmasked original* is
        // what comes back — the design's own image_style re-applies the mask at preview time,
        // and restoring the masked copy would mask it a second time
        const source = image.original ?? image
        if (source.source !== 'upload' || !source.path){
            // An external url needs nothing copied; just drop back to the unmasked reference
            if (image.original){
                Object.assign(image, {...source, original: null})
            }
            continue
        }
        const moved = plan_image_into_design({...source, original: null}, design_id)
        Object.assign(image, moved.image)
        copies.push(...moved.copies)
    }

    // Best-effort as a whole: a design that keeps a stale reference still renders until the
    // source version is deleted, whereas failing here would block the duplicate/restore itself
    try {
        await apply_asset_copies(copies)
    } catch (error){
        report_error('silent', error, {context: {stage: 'rehydrate_version_assets'}})
    }

    return copy
}
