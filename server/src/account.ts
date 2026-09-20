
// Account deletion — removing a user and everything they own, in one call.
//
// Server-side for the same reasons design deletion is (clients have no delete rule on any
// Storage prefix, and the Firestore rules only let a version's own creator delete it), plus one
// of its own: retiring the Auth user needs the Admin SDK regardless.
//
// Ordering is deliberate throughout: the Auth account goes *last*, because it is the retryable
// handle for everything before it. Delete it first and a failure halfway through would leave
// orphaned docs and objects with no signed-in user left who could ask for them again.

import {FieldPath, FieldValue, Timestamp} from 'firebase-admin/firestore'
import {version_assets_prefix} from 'paper-bible-typst'

import {admin_db, admin_auth} from './firebase.ts'
import {QUOTA_COLLECTIONS} from './quota.ts'
import {ChunkedBatch} from './batch.ts'
import {collect_version_basenames, delete_prefix, design_prefixes, sweep_prefix} from './assets.ts'


interface HandlerResult {
    status:number
    body:Record<string, unknown>
}


// What a deletion removed, returned so the client can report it and so a retry's second pass
// reading all zeroes is distinguishable from the first having done nothing
export interface DeletionSummary {
    designs:number  // Designs owned and destroyed
    versions:number  // Version docs removed (owned designs' + this user's on others' designs)
    left:number  // Shared designs the user was merely an editor of, and has now left
}


async function versions_of(design_id:string):Promise<FirebaseFirestore.QuerySnapshot>{
    // Every version of a design, whoever created it
    return await admin_db.collection('versions').where('design_id', '==', design_id).get()
}


async function delete_owned_designs(uid:string):Promise<{designs:number, versions:number}>{
    // Destroy every design the user owns, exactly as /api/delete_design would.
    //
    // A shared design goes with its owner, co-editors' versions included. That's the same
    // decision handle_delete_design already makes when an owner deletes a design by hand — the
    // alternative (silently transferring ownership to a co-editor) would leave the departing
    // user's content on the service after they asked for it to be gone
    const owned = await admin_db.collection('designs').where('owner', '==', uid).get()
    let versions_removed = 0

    for (const design of owned.docs){
        const versions = await versions_of(design.id)

        // Version docs first, then their rendered PDFs, then the design's asset prefixes, and
        // the design doc last — a partial failure leaves the design still listed and retryable
        const batch = new ChunkedBatch()
        for (const version of versions.docs){
            batch.delete(version.ref)
        }
        await batch.commit()
        versions_removed += versions.docs.length

        for (const version of versions.docs){
            await delete_prefix(`versions/${version.id}/`)
        }
        for (const prefix of design_prefixes(design.id)){
            await delete_prefix(prefix)
        }
        await design.ref.delete()
    }

    return {designs: owned.docs.length, versions: versions_removed}
}


async function delete_versions_on_others_designs(uid:string):Promise<number>{
    // Versions this user created on designs belonging to someone else. They're the departing
    // user's data, so they go — but the design itself stays, because it isn't theirs.
    //
    // Grouped by parent design so each one's leftover snapshots are swept and its denormalized
    // summary repointed once, rather than once per version (what calling handle_delete_version
    // in a loop would do)
    const owned = await admin_db.collection('versions').where('owner', '==', uid).get()
    if (!owned.docs.length){
        return 0
    }

    const by_design = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
    for (const version of owned.docs){
        const design_id = version.data()['design_id'] as string
        // A version whose parent design this same call already destroyed is gone with it
        if (typeof design_id !== 'string'){
            continue
        }
        by_design.set(design_id, [...by_design.get(design_id) ?? [], version])
    }

    let removed = 0
    for (const [design_id, versions] of by_design){
        const design_ref = admin_db.doc(`designs/${design_id}`)
        const design = (await design_ref.get()).data()
        if (design === undefined){
            // Parent already gone (deleted above, or by its owner meanwhile) — the doc still
            // needs removing, but there's no design left to sweep or repoint
            const batch = new ChunkedBatch()
            for (const version of versions){
                batch.delete(version.ref)
            }
            await batch.commit()
            for (const version of versions){
                await delete_prefix(`versions/${version.id}/`)
            }
            removed += versions.length
            continue
        }

        const batch = new ChunkedBatch()
        for (const version of versions){
            batch.delete(version.ref)
        }
        await batch.commit()
        for (const version of versions){
            await delete_prefix(`versions/${version.id}/`)
        }
        removed += versions.length

        // Reclaim the snapshots no surviving version of that design still references — the only
        // thing that ever frees version_assets/, which is otherwise append-only for its life
        const remaining = await versions_of(design_id)
        const keep = new Set<string>()
        for (const version of remaining.docs){
            for (const name of collect_version_basenames(version.data())){
                keep.add(name)
            }
        }
        await sweep_prefix(version_assets_prefix(design_id), keep)

        // The design's own owner is still using it, so its summary must not be left describing
        // a version that no longer exists (same repoint handle_delete_version does)
        const summary = design['latest_version'] as {save_token?:string}|null|undefined
        const deleted_tokens = new Set(versions.map(item => item.data()['save_token'] as string))
        if (summary?.save_token !== undefined && deleted_tokens.has(summary.save_token)){
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
    }

    return removed
}


async function leave_shared_designs(uid:string):Promise<number>{
    // Step out of designs owned by someone else. Their content isn't this user's to delete, so
    // only the membership goes — the design carries on for whoever else can edit it
    const shared = await admin_db.collection('designs')
        .where('editor_uids', 'array-contains', uid).get()
    const batch = new ChunkedBatch()
    let left = 0
    for (const design of shared.docs){
        // Owned designs were destroyed already; anything still matching here belongs to someone
        // else (or is a straggler whose delete failed, which a retry will pick up)
        if (design.data()['owner'] === uid){
            continue
        }
        batch.update(design.ref, {editor_uids: FieldValue.arrayRemove(uid)})
        batch.update(design.ref, new FieldPath('editors', uid), FieldValue.delete())
        left += 1
    }
    await batch.commit()
    return left
}


async function delete_user_records(uid:string):Promise<void>{
    // The user's own documents: profile, read-access history, every daily throttle counter,
    // and the compile telemetry rows carrying their uid.
    //
    // NOTE Error reports are deliberately not swept. They're stored by message fingerprint
    // (errors/{fingerprint}/{id}.json), not by uid, so finding this user's would mean listing
    // and parsing the entire prefix on every deletion. They carry a uid and an IP but nothing a
    // user wrote, and the bucket's 90-day lifecycle rule removes them on its own
    const batch = new ChunkedBatch()

    const viewed = await admin_db.collection(`users/${uid}/viewed`).get()
    for (const entry of viewed.docs){
        batch.delete(entry.ref)
    }
    batch.delete(admin_db.doc(`users/${uid}`))
    // Every quota collection, so a new one can't be added without being cleaned up here — the
    // rows would otherwise outlive the account until their TTL caught up
    for (const collection of QUOTA_COLLECTIONS){
        batch.delete(admin_db.doc(`${collection}/${uid}`))
    }

    // Single-field equality, so Firestore's automatic index covers this with nothing declared
    const stats = await admin_db.collection('compile_stats').where('owner', '==', uid).get()
    for (const row of stats.docs){
        batch.delete(row.ref)
    }

    await batch.commit()
}


export async function handle_delete_account(uid:string):Promise<HandlerResult>{
    // Delete the caller's account and everything it owns. Idempotent: every step tolerates
    // having already run, so a client that retries after a partial failure finishes the job
    // rather than erroring on what's already gone
    const owned = await delete_owned_designs(uid)
    const orphan_versions = await delete_versions_on_others_designs(uid)
    const left = await leave_shared_designs(uid)
    await delete_user_records(uid)

    // Last, for the reason at the top of this file: until it goes, the user can still
    // authenticate and ask again
    await admin_auth.deleteUser(uid).catch((error:unknown) => {
        // Already gone (a retry of a call that got this far) is success, not failure
        if ((error as {code?:string}).code !== 'auth/user-not-found'){
            throw error
        }
    })

    const summary:DeletionSummary = {
        designs: owned.designs,
        versions: owned.versions + orphan_versions,
        left,
    }
    return {status: 200, body: {ok: true, ...summary}}
}
