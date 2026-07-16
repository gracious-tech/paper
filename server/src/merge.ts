
import {FieldPath, FieldValue} from 'firebase-admin/firestore'

import {admin_auth, admin_db, admin_bucket} from './firebase.ts'


// Firestore batches cap at 500 operations (and field transforms count extra), so stay well
// under it per chunk — a guest with a large history must not fail the whole merge
const BATCH_CHUNK_OPS = 250


// A WriteBatch stand-in that transparently rotates to a new batch at the chunk limit and
// commits them sequentially. Chunking trades the single batch's atomicity for unbounded size,
// which is fine here — the merge only moves docs, so a partial failure just leaves some data
// on the guest account for a retry to pick up
class ChunkedBatch {

    private batches:FirebaseFirestore.WriteBatch[] = []
    private ops = 0

    private next():FirebaseFirestore.WriteBatch{
        // The batch currently being filled, rotating at the chunk limit
        if (this.ops % BATCH_CHUNK_OPS === 0){
            this.batches.push(admin_db.batch())
        }
        this.ops += 1
        return this.batches[this.batches.length - 1]!
    }

    update(ref:FirebaseFirestore.DocumentReference,
            ...args:[FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>]
                |[string|FieldPath, unknown, ...unknown[]]):void{
        // Mirror WriteBatch.update (both the object and field/value forms)
        (this.next().update as (ref:FirebaseFirestore.DocumentReference,
            ...rest:unknown[]) => unknown)(ref, ...args)
    }

    set(ref:FirebaseFirestore.DocumentReference, data:FirebaseFirestore.DocumentData,
            options?:FirebaseFirestore.SetOptions):void{
        // Mirror WriteBatch.set
        if (options){
            this.next().set(ref, data, options)
        } else {
            this.next().set(ref, data)
        }
    }

    delete(ref:FirebaseFirestore.DocumentReference):void{
        // Mirror WriteBatch.delete
        this.next().delete(ref)
    }

    async commit():Promise<void>{
        // Commit all accumulated chunks in order
        for (const batch of this.batches){
            await batch.commit()
        }
    }
}


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

    // User profile + custom font library docs
    const profile = await admin_db.doc(`users/${anon_uid}`).get()
    if (profile.exists){
        batch.set(admin_db.doc(`users/${new_uid}`), profile.data() ?? {}, {merge: true})
        batch.delete(profile.ref)
    }
    const fonts = await admin_db.collection(`users/${anon_uid}/fonts`).get()
    for (const snap of fonts.docs){
        const data = snap.data()
        const files = ((data['files'] ?? []) as string[]).map(
            path => path.replace(`user_fonts/${anon_uid}/`, `user_fonts/${new_uid}/`))
        batch.set(admin_db.doc(`users/${new_uid}/fonts/${snap.id}`), {...data, files})
        batch.delete(snap.ref)
    }

    // Read-access "viewed" history
    const viewed = await admin_db.collection(`users/${anon_uid}/viewed`).get()
    for (const snap of viewed.docs){
        batch.set(admin_db.doc(`users/${new_uid}/viewed/${snap.id}`), snap.data())
        batch.delete(snap.ref)
    }

    await batch.commit()

    // Custom font files in Storage
    const [font_files] = await admin_bucket.getFiles({prefix: `user_fonts/${anon_uid}/`})
    for (const file of font_files){
        await file.copy(admin_bucket.file(
            file.name.replace(`user_fonts/${anon_uid}/`, `user_fonts/${new_uid}/`)))
        await file.delete()
    }

    // Retire the guest account
    await admin_auth.deleteUser(anon_uid)
    return {status: 200, body: {ok: true}}
}
