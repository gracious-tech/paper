
// Guest-to-existing-account merge.
//
// The whole authorisation here is "the caller can still produce the guest's ID token", so the
// checks around that token are the security boundary: only a genuinely anonymous account may be
// absorbed, and only by someone holding its credential.

import {describe, it, expect, beforeEach} from 'vitest'

import {handle_merge} from '../../server/src/merge.ts'
import {admin_db, admin_auth, reset_firestore, reset_auth, make_anon_user, id_token_for,
    design_doc, version_doc, new_id} from '../helpers/server.ts'


let guest:{uid:string, id_token:string}
let keeper:string


beforeEach(async () => {
    await reset_firestore()
    await reset_auth()
    guest = await make_anon_user()
    keeper = (await admin_auth.createUser({email: 'keeper@example.com', password: 'secret123'}))
        .uid
})


// A design owned by (or shared with) the given uid
async function make_design(overrides:Record<string, unknown>):Promise<string>{
    const id = new_id()
    await admin_db.doc(`designs/${id}`).set(design_doc(overrides))
    return id
}


describe('token validation', () => {

    it('refuses a token that is not a valid ID token', async () => {
        const result = await handle_merge(keeper, 'not-a-token')
        expect(result.status).toBe(401)
        expect(result.body).toEqual({error: 'bad_anon_token'})
    })

    it('refuses an empty token', async () => {
        expect((await handle_merge(keeper, '')).status).toBe(401)
    })

    it('does nothing when the token is the caller\'s own', async () => {
        const result = await handle_merge(guest.uid, guest.id_token)
        expect(result.status).toBe(200)
        // And the account survives — a self-merge must not delete the caller
        expect(await admin_auth.getUser(guest.uid)).toBeTruthy()
    })

    it('refuses to absorb an account with a real credential', async () => {
        // A real account should never be auto-drained, however valid the token
        const real_token = await id_token_for(keeper)
        const other = await make_anon_user()
        const result = await handle_merge(other.uid, real_token)
        expect(result.status).toBe(403)
        expect(result.body).toEqual({error: 'not_anonymous'})
        expect(await admin_auth.getUser(keeper)).toBeTruthy()
    })

    it('refuses a token for an account that has since been deleted', async () => {
        // Rejected at verification rather than by the unknown_account branch below it —
        // verifyIdToken resolves the user, so a token for a deleted account never validates.
        // That branch is therefore defence in depth, not the path this case takes
        await admin_auth.deleteUser(guest.uid)
        const result = await handle_merge(keeper, guest.id_token)
        expect(result.status).toBe(401)
        expect(result.body).toEqual({error: 'bad_anon_token'})
    })
})


describe('data transfer', () => {

    it('moves ownership of the guest\'s designs', async () => {
        const id = await make_design({owner: guest.uid, editor_uids: [guest.uid]})
        await handle_merge(keeper, guest.id_token)
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data!['owner']).toBe(keeper)
        expect(data!['editor_uids']).toEqual([keeper])
    })

    it('swaps the uid in a design the guest was merely invited to', async () => {
        const id = await make_design({owner: 'someone_else',
            editor_uids: ['someone_else', guest.uid],
            editors: {[guest.uid]: {joined: new Date()}}})
        await handle_merge(keeper, guest.id_token)
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data!['owner']).toBe('someone_else')
        expect(data!['editor_uids']).toEqual(['someone_else', keeper])
        const editors = data!['editors'] as Record<string, unknown>
        expect(keeper in editors).toBe(true)
        expect(guest.uid in editors).toBe(false)
    })

    it('does not duplicate the uid when both accounts already edit one design', async () => {
        const id = await make_design({owner: 'someone_else',
            editor_uids: ['someone_else', guest.uid, keeper]})
        await handle_merge(keeper, guest.id_token)
        const editor_uids = (await admin_db.doc(`designs/${id}`).get())
            .data()!['editor_uids'] as string[]
        expect(editor_uids.filter(uid => uid === keeper)).toHaveLength(1)
    })

    it('moves the guest\'s versions', async () => {
        const design_id = await make_design({owner: guest.uid, editor_uids: [guest.uid]})
        const version_id = new_id()
        await admin_db.doc(`versions/${version_id}`).set(
            version_doc(design_id, {owner: guest.uid}))
        await handle_merge(keeper, guest.id_token)
        expect((await admin_db.doc(`versions/${version_id}`).get()).data()!['owner'])
            .toBe(keeper)
    })

    it('leaves another user\'s version on a transferred design alone', async () => {
        const design_id = await make_design(
            {owner: guest.uid, editor_uids: [guest.uid, 'someone_else']})
        const version_id = new_id()
        await admin_db.doc(`versions/${version_id}`).set(
            version_doc(design_id, {owner: 'someone_else'}))
        await handle_merge(keeper, guest.id_token)
        expect((await admin_db.doc(`versions/${version_id}`).get()).data()!['owner'])
            .toBe('someone_else')
    })

    it('merges the guest\'s profile into the keeper\'s', async () => {
        await admin_db.doc(`users/${guest.uid}`).set({print_warning_seen: true})
        await admin_db.doc(`users/${keeper}`).set({other_pref: 'kept'})
        await handle_merge(keeper, guest.id_token)
        const data = (await admin_db.doc(`users/${keeper}`).get()).data()
        expect(data).toEqual({print_warning_seen: true, other_pref: 'kept'})
        expect((await admin_db.doc(`users/${guest.uid}`).get()).exists).toBe(false)
    })

    it('moves the read-access history', async () => {
        await admin_db.doc(`users/${guest.uid}/viewed/d1`).set(
            {design_id: 'd1', title: 'Genesis'})
        await handle_merge(keeper, guest.id_token)
        expect((await admin_db.doc(`users/${keeper}/viewed/d1`).get()).data())
            .toEqual({design_id: 'd1', title: 'Genesis'})
        expect((await admin_db.doc(`users/${guest.uid}/viewed/d1`).get()).exists).toBe(false)
    })

    it('leaves Storage untouched — assets are keyed by design, not by uid', async () => {
        // A design keeps its id through a merge, so every path stays valid and no blueprint
        // needs re-pointing
        const id = await make_design(design_id => ({owner: guest.uid,
            editor_uids: [guest.uid], design_id}) as Record<string, unknown>)
        await handle_merge(keeper, guest.id_token)
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data!['blueprint']).toEqual({font_size: 10, cover: null})
    })

    it('retires the guest account', async () => {
        await handle_merge(keeper, guest.id_token)
        await expect(admin_auth.getUser(guest.uid)).rejects.toThrow()
    })

    it('succeeds for a guest with nothing to move', async () => {
        const result = await handle_merge(keeper, guest.id_token)
        expect(result.status).toBe(200)
        expect(result.body).toEqual({ok: true})
    })

    it('moves a guest with several designs and versions in one call', async () => {
        const ids = await Promise.all([
            make_design({owner: guest.uid, editor_uids: [guest.uid]}),
            make_design({owner: guest.uid, editor_uids: [guest.uid]}),
            make_design({owner: guest.uid, editor_uids: [guest.uid]}),
        ])
        await handle_merge(keeper, guest.id_token)
        for (const id of ids){
            expect((await admin_db.doc(`designs/${id}`).get()).data()!['owner']).toBe(keeper)
        }
    })
})
