
// A design's binary assets (images, fonts), server-side.
//
// Uploads belong to a design rather than an account (see asset_paths.ts in the typst core for
// the scheme). Three prefixes, all keyed by design id and content-addressed:
//   design_assets/{did}/   what the live design references — swept here when it stops
//   version_assets/{did}/  frozen snapshots, shared by every version, append-only
//   design_cache/{did}/    regenerable derived images, swept by a lifecycle rule
//
// Only the server can delete: clients have no delete rule on any of them, which is what stops
// an editor removing the bytes a published version renders from. Everything below therefore
// runs on the Admin SDK and does its own ownership checks.

import {join_blueprint_doc, design_assets_prefix, version_assets_prefix, design_cache_prefix,
    asset_basename} from 'paper-bible-typst'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'

import type {Blueprint, ContentItem, ContentPassageImage, StoredFontMeta}
    from 'paper-bible-typst'


// How recently an object may have been created and still be swept. An upload lands before the
// debounced design write that names it (SAVE_DEBOUNCE_MS in designs.ts, plus round trips), so
// re-reading the doc server-side isn't enough on its own — a reconcile triggered by a
// co-editor in that gap would delete a file the doc simply doesn't mention *yet*. Generous,
// because the cost of waiting is a little unused space and the cost of being wrong is someone
// else's image
const SWEEP_GRACE_MS = 10 * 60 * 1000


export function storage_public_url(path:string):string{
    // The public download URL for a Storage object, built deterministically rather than via a
    // signed-url round trip — byte-identical to the app's own storage_public_url(), since both
    // write the `url` a frozen blueprint carries and the compile fetches
    const base = config.dev ? 'http://localhost:9199' : 'https://firebasestorage.googleapis.com'
    return `${base}/v0/b/${admin_bucket.name}/o/${encodeURIComponent(path)}?alt=media`
}


function each_image(blueprint:Blueprint, visit:(image:ContentPassageImage) => void):void{
    // Visit every passage/picture-story image config in a blueprint's content, in place.
    // Deliberately defensive at each step — the blueprint comes off a client-written doc, and
    // the security rules only require it to be a map
    for (const item of Array.isArray(blueprint.content) ? blueprint.content : []){
        if (item?.type === 'passage' && item.image){
            visit(item.image)
        } else if (item?.type === 'picture_story'){
            for (const slide of Array.isArray(item.slides) ? item.slides : []){
                if (slide?.image){
                    visit(slide.image)
                }
            }
        }
    }
}


export function collect_image_urls(blueprint:Blueprint):string[]{
    // Every url a compile of this blueprint would fetch (see image_cache.ts)
    const urls:string[] = []
    each_image(blueprint, image => {
        if (typeof image.url === 'string' && image.url){
            urls.push(image.url)
        }
    })
    return urls
}


export function join_design_blueprint(data:FirebaseFirestore.DocumentData):Blueprint{
    // Reassemble a design doc's split blueprint fields into a whole Blueprint, migrating an
    // older-schema doc to the current shape on the way (see migrate.ts). The upgrade is in
    // memory only — this server only ever reads designs to find the assets they reference, and
    // converging the doc is the editing client's job (see flush_changes in designs.ts)
    return join_blueprint_doc({
        blueprint: (data['blueprint'] ?? {}) as Record<string, unknown>,
        content_items: (data['content_items'] ?? {}) as Record<string, ContentItem>,
        content_order: (data['content_order'] ?? []) as string[],
        name: (data['name'] ?? '') as string,
        schema: typeof data['schema'] === 'number' ? data['schema'] : 1,
    })
}


function collect_basenames(blueprint:Blueprint, fonts:Iterable<StoredFontMeta>):Set<string>{
    // Every asset a blueprint plus its font records reference, as bare content-addressed
    // basenames — the form that's identical across all three prefixes. Only the basename of a
    // client-written path is ever used, so a doc naming somewhere it shouldn't can't reach
    // outside the design's own prefixes
    const names = new Set<string>()

    const bg = blueprint.cover?.bg_image
    if (bg?.kind === 'custom' && typeof bg.path === 'string'){
        names.add(asset_basename(bg.path))
    }
    // Both the (possibly masked) image and the unmasked original it was derived from — the
    // render needs the first, turning the version back into a design needs the second
    each_image(blueprint, image => {
        for (const ref of [image, image.original]){
            if (ref?.source === 'upload' && typeof ref.path === 'string'){
                names.add(asset_basename(ref.path))
            }
        }
    })

    for (const entry of fonts){
        for (const path of entry?.files ?? []){
            if (typeof path === 'string'){
                names.add(asset_basename(path))
            }
        }
    }

    return names
}


export function collect_asset_basenames(data:FirebaseFirestore.DocumentData):Set<string>{
    // What a *design* doc references: a blueprint split across sibling fields, and fonts as a
    // map keyed by font id
    return collect_basenames(join_design_blueprint(data),
        Object.values((data['fonts'] ?? {}) as Record<string, StoredFontMeta>))
}


export function collect_version_basenames(data:FirebaseFirestore.DocumentData):Set<string>{
    // What a *version* doc references. Same assets, two different doc shapes: a version holds
    // its blueprint whole (it's frozen, so it never needs field-level merging) and its fonts
    // as a plain array
    return collect_basenames((data['blueprint'] ?? {}) as Blueprint,
        (data['custom_fonts'] ?? []) as StoredFontMeta[])
}


export function repath_assets(blueprint:Blueprint, prefix:string):Blueprint{
    // Point a blueprint's asset references at the given prefix of the given design, keeping
    // each one's content-addressed basename. Used both ways: into version_assets when copying
    // a version, and into design_assets when that copy also becomes an editable design
    const copy = structuredClone(blueprint)
    const bg = copy.cover?.bg_image
    if (bg?.kind === 'custom' && typeof bg.path === 'string'){
        bg.path = prefix + asset_basename(bg.path)
    }
    each_image(copy, image => {
        for (const ref of [image, image.original]){
            if (ref?.source === 'upload' && typeof ref.path === 'string'){
                ref.path = prefix + asset_basename(ref.path)
                ref.url = storage_public_url(ref.path)
            }
        }
    })
    return copy
}


export async function copy_basenames(from_prefix:string, to_prefix:string,
        names:Iterable<string>):Promise<void>{
    // Copy assets between two prefixes server-side — no bytes travel to or from this process.
    // Missing sources are skipped rather than fatal: an asset can legitimately be gone (a
    // source version whose design was deleted mid-copy), and losing one picture is a far
    // better outcome than failing the whole operation
    for (const name of names){
        const source = admin_bucket.file(from_prefix + name)
        if (!(await source.exists())[0]){
            continue
        }
        await source.copy(admin_bucket.file(to_prefix + name))
    }
}


export async function sweep_prefix(prefix:string, keep:Set<string>):Promise<number>{
    // Delete everything under a prefix that isn't named in `keep` and is old enough to be
    // judged (see SWEEP_GRACE_MS). Returns how many objects went
    const [files] = await admin_bucket.getFiles({prefix})
    const cutoff = Date.now() - SWEEP_GRACE_MS
    let swept = 0
    for (const file of files){
        if (keep.has(asset_basename(file.name))){
            continue
        }
        const created = Date.parse((file.metadata.timeCreated ?? '') as string)
        if (Number.isFinite(created) && created > cutoff){
            continue
        }
        await file.delete().catch(() => undefined)
        swept += 1
    }
    return swept
}


export async function delete_prefix(prefix:string):Promise<void>{
    // Remove every object under a prefix (design deletion). Best-effort — a design doc that
    // outlives a failed sweep can be deleted again
    await admin_bucket.deleteFiles({prefix, force: true}).catch(() => undefined)
}


export async function handle_reconcile_assets(uid:string, design_id:string)
        :Promise<{status:number, body:Record<string, unknown>}>{
    // Reclaim whatever a design's live asset prefix holds that the design no longer names.
    //
    // Deliberately server-side rather than deleted by the client that made the change: the
    // doc is re-read here, so this sees co-editors' concurrent edits that the requesting
    // client may not have received yet. Deleting from a stale local blueprint could destroy an
    // asset somebody else just started using.
    //
    // Only design_assets/ is swept. version_assets/ is append-only by design (a published
    // version must keep rendering), and design_cache/ holds derived files the design doc never
    // names, so sweeping it here would delete all of them
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined
            || !((data['editor_uids'] ?? []) as string[]).includes(uid)){
        return {status: 404, body: {error: 'not_found'}}
    }
    const swept = await sweep_prefix(design_assets_prefix(design_id),
        collect_asset_basenames(data))
    return {status: 200, body: {swept}}
}


export async function handle_touch_assets(uid:string, design_id:string)
        :Promise<{status:number, body:Record<string, unknown>}>{
    // Mark a design's live assets as in use, by stamping each object's GCS `customTime`.
    // Nothing reads this yet — it's the groundwork for a future `daysSinceCustomTime` rule
    // that could reclaim the uploads of abandoned accounts. Age alone can't do that job: it
    // would delete images out of designs still in daily use, whereas customTime makes the
    // sweep a genuine "untouched for N years".
    //
    // Deliberately inert for now. Turning on a rule before this has been stamping for a good
    // while would delete files that simply hadn't been visited yet, so the stamping has to
    // come first and run long enough to be trusted. It must also never target version_assets/,
    // which has to outlive the design's activity for as long as any version doc exists
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined
            || !((data['editor_uids'] ?? []) as string[]).includes(uid)){
        return {status: 404, body: {error: 'not_found'}}
    }

    const prefix = design_assets_prefix(design_id)
    const names = collect_asset_basenames(data)
    // Best-effort and independent: one unreadable object must not cost the others their stamp.
    // GCS only lets customTime move forward, which is all this ever does
    const now = new Date().toISOString()
    await Promise.allSettled([...names].map(name =>
        admin_bucket.file(prefix + name).setMetadata({customTime: now})))

    return {status: 200, body: {touched: names.size}}
}


export function design_prefixes(design_id:string):string[]{
    // Every Storage prefix a design owns, for deleting it wholesale
    return [design_assets_prefix(design_id), version_assets_prefix(design_id),
        design_cache_prefix(design_id)]
}
