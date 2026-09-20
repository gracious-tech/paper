
// Design lifecycle operations that clients can't perform themselves.
//
// Deleting or duplicating a design means touching Storage objects under prefixes no client
// has a delete rule on (see assets.ts for why), and deleting a *shared* design means removing
// versions owned by other editors, which the Firestore rules also forbid. Both therefore run
// here on the Admin SDK, with the ownership check done in code instead.

import {randomBytes} from 'node:crypto'

import {Timestamp} from 'firebase-admin/firestore'
import {split_blueprint_doc, design_assets_prefix, version_assets_prefix, SCHEMA_VERSION}
    from 'paper-bible-typst'

import {admin_db} from './firebase.ts'
import {ChunkedBatch} from './batch.ts'
import {collect_asset_basenames, collect_version_basenames, copy_basenames, delete_prefix,
    design_prefixes, join_design_blueprint, repath_assets, sweep_prefix} from './assets.ts'

import type {StoredFontMeta} from 'paper-bible-typst'


interface HandlerResult {
    status:number
    body:Record<string, unknown>
}


function new_id():string{
    // Matches the client's generate_token() — url64, unguessable, and the whole capability for
    // anything keyed by it
    return randomBytes(15).toString('base64url')
}


async function versions_of(design_id:string):Promise<FirebaseFirestore.QuerySnapshot>{
    // Every version of a design, whoever created it
    return await admin_db.collection('versions').where('design_id', '==', design_id).get()
}


export async function handle_delete_design(uid:string, design_id:string)
        :Promise<HandlerResult>{
    // Delete a design, its whole render history, and every object any of it owns.
    //
    // Ordering matters: everything else goes before the design doc, so a partial failure
    // leaves the design still listed and the whole call retryable. Deleting the design first
    // would strand its versions and objects with nothing left pointing at them
    const ref = admin_db.doc(`designs/${design_id}`)
    const snap = await ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 200, body: {ok: true}}  // Already gone — idempotent
    }
    if (data['owner'] !== uid){
        // Same response as missing: an editor who isn't the owner learns nothing either way
        return {status: 404, body: {error: 'not_found'}}
    }

    // Version docs, including any a co-editor created — the client rules only let an owner
    // delete their own, which is exactly why this has to happen here
    const versions = await versions_of(design_id)
    const batch = new ChunkedBatch()
    for (const version of versions.docs){
        batch.delete(version.ref)
    }
    await batch.commit()

    // Each version's rendered PDFs, then the design's three asset prefixes
    for (const version of versions.docs){
        await delete_prefix(`versions/${version.id}/`)
    }
    for (const prefix of design_prefixes(design_id)){
        await delete_prefix(prefix)
    }

    await ref.delete()
    return {status: 200, body: {ok: true}}
}


export async function handle_delete_version(uid:string, version_id:string)
        :Promise<HandlerResult>{
    // Delete one version: its doc, its PDFs, and any snapshot no *other* version still needs.
    // The parent design's denormalized summary is repointed here too, so it can't be left
    // describing a version that no longer exists
    const ref = admin_db.doc(`versions/${version_id}`)
    const snap = await ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 200, body: {ok: true}}  // Already gone — idempotent
    }
    const design_id = data['design_id'] as string
    const design_ref = admin_db.doc(`designs/${design_id}`)
    const design = (await design_ref.get()).data()
    // The version's own creator, or the owner of the design it belongs to
    if (data['owner'] !== uid && design?.['owner'] !== uid){
        return {status: 404, body: {error: 'not_found'}}
    }

    await ref.delete()
    await delete_prefix(`versions/${version_id}/`)

    // Whatever the remaining versions of this design still reference. This is the only thing
    // that ever reclaims version_assets/, which is otherwise append-only for the design's life
    const remaining = await versions_of(design_id)
    const keep = new Set<string>()
    for (const version of remaining.docs){
        for (const name of collect_version_basenames(version.data())){
            keep.add(name)
        }
    }
    await sweep_prefix(version_assets_prefix(design_id), keep)

    // Repoint the design's summary if it described the version just deleted, otherwise the
    // /designs row keeps reporting a page count and status for something that's gone (and
    // design_needs_version() would keep reading false)
    const summary = design?.['latest_version'] as {save_token?:string}|null|undefined
    if (design && summary?.save_token === data['save_token']){
        const newest = remaining.docs
            .map(item => item.data())
            .sort((a, b) => ((b['created'] as Timestamp|undefined)?.toMillis() ?? 0)
                - ((a['created'] as Timestamp|undefined)?.toMillis() ?? 0))[0]
        await design_ref.update({
            latest_version: newest
                ? {status: newest['status'], pages: newest['pages'] ?? null,
                    save_token: newest['save_token']}
                : null,
        })
    }

    return {status: 200, body: {ok: true}}
}


export async function handle_duplicate_design(uid:string, design_id:string)
        :Promise<HandlerResult>{
    // Copy a design's live content into a brand new design owned by the caller (no version
    // history). Server-side because the new design needs its own copies of every asset, and
    // copying them here moves no bytes over the wire — the client would have to download and
    // re-upload each one
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined
            || !((data['editor_uids'] ?? []) as string[]).includes(uid)){
        return {status: 404, body: {error: 'not_found'}}
    }

    const new_design_id = new_id()
    const new_prefix = design_assets_prefix(new_design_id)
    await copy_basenames(design_assets_prefix(design_id), new_prefix,
        collect_asset_basenames(data))

    // Basenames are content-addressed, so re-pointing the blueprint at the new prefix is all
    // that's needed — the same name identifies the same bytes
    const blueprint = repath_assets(join_design_blueprint(data), new_prefix)

    // Fonts get fresh ids under the new design, pointing at its own copies
    const fonts:Record<string, StoredFontMeta> = {}
    for (const entry of Object.values((data['fonts'] ?? {}) as Record<string, StoredFontMeta>)){
        fonts[new_id()] = {
            family: entry.family,
            style: entry.style,
            files: (entry.files ?? []).map(
                path => new_prefix + path.slice(path.lastIndexOf('/') + 1)),
        }
    }

    await admin_db.doc(`designs/${new_design_id}`).set({
        schema: SCHEMA_VERSION,
        owner: uid,
        editor_uids: [uid],
        editors: {},
        share_token: new_id(),
        name_auto: data['name_auto'] ?? '',
        save_token: new_id(),
        created: Timestamp.now(),
        modified: Timestamp.now(),
        category: data['category'] ?? null,
        latest_version: null,
        fonts,
        // A copy of a simple design is simple too
        ...(data['wizard_draft']
            ? {simple_mode: !!data['simple_mode'], wizard_draft: data['wizard_draft']}
            : {}),
        ...split_blueprint_doc(blueprint),
    })

    return {status: 200, body: {design_id: new_design_id}}
}
