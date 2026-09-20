
import {FieldPath, FieldValue} from 'firebase-admin/firestore'

import {admin_auth, admin_db} from './firebase.ts'
import {ChunkedBatch} from './batch.ts'


export async function handle_merge(new_uid:string, anon_token:string)
        :Promise<{status:number, body:Record<string, unknown>}>{
    // Move a guest account's data into the caller's account. Used when upgrading a guest whose
    // chosen credential already belonged to an existing account: the client signs into the
    // existing account, then proves ownership of the guest account via its (still valid) token.

    // Validate the guest account
    let anon_uid:string
    try {
        anon_uid = (await admin_auth.verifyIdToken(anon_token)).uid
    } catch {
        return {status: 401, body: {error: 'bad_anon_token'}}
    }
    if (anon_uid === new_uid){
        return {status: 200, body: {ok: true}}  // Nothing to do
    }
    const anon_user = await admin_auth.getUser(anon_uid).catch(() => null)
    if (!anon_user){
        return {status: 404, body: {error: 'unknown_account'}}
    }
    if (anon_user.providerData.length > 0){
        // Only guest accounts may be absorbed (a real account should never be auto-drained)
        return {status: 403, body: {error: 'not_anonymous'}}
    }

    const batch = new ChunkedBatch()

    // Designs the guest could edit (owned + shared with them): swap the uid everywhere
    const designs = await admin_db.collection('designs')
        .where('editor_uids', 'array-contains', anon_uid).get()
    for (const snap of designs.docs){
        const data = snap.data()
        const editor_uids = [...new Set((data['editor_uids'] as string[])
            .map(uid => uid === anon_uid ? new_uid : uid))]
        batch.update(snap.ref, {
            editor_uids,
            ...(data['owner'] === anon_uid ? {owner: new_uid} : {}),
        })
        const editors = (data['editors'] ?? {}) as Record<string, unknown>
        if (anon_uid in editors){
            batch.update(snap.ref,
                new FieldPath('editors', new_uid), editors[anon_uid],
                new FieldPath('editors', anon_uid), FieldValue.delete())
        }
    }

    // Versions the guest owns
    const versions = await admin_db.collection('versions')
        .where('owner', '==', anon_uid).get()
    for (const snap of versions.docs){
        batch.update(snap.ref, {owner: new_uid})
    }

    // User profile
    const profile = await admin_db.doc(`users/${anon_uid}`).get()
    if (profile.exists){
        batch.set(admin_db.doc(`users/${new_uid}`), profile.data() ?? {}, {merge: true})
        batch.delete(profile.ref)
    }
    // Read-access "viewed" history
    const viewed = await admin_db.collection(`users/${anon_uid}/viewed`).get()
    for (const snap of viewed.docs){
        batch.set(admin_db.doc(`users/${new_uid}/viewed/${snap.id}`), snap.data())
        batch.delete(snap.ref)
    }

    await batch.commit()

    // NOTE Nothing moves in Storage. Uploaded assets are keyed by *design* id, not by uid
    // (see asset_paths.ts), and a design keeps its id through a merge — so every path stays
    // valid and no blueprint needs repointing

    // Retire the guest account
    await admin_auth.deleteUser(anon_uid)
    return {status: 200, body: {ok: true}}
}
