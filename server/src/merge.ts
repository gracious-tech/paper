
import {FieldPath, FieldValue} from 'firebase-admin/firestore'

import {admin_auth, admin_db, admin_bucket} from './firebase.ts'


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

    const batch = admin_db.batch()

    // Drafts the guest could edit (owned + shared with them): swap the uid everywhere
    const drafts = await admin_db.collection('drafts')
        .where('editor_uids', 'array-contains', anon_uid).get()
    for (const snap of drafts.docs){
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

    // Creations the guest owns
    const creations = await admin_db.collection('creations')
        .where('owner', '==', anon_uid).get()
    for (const snap of creations.docs){
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
