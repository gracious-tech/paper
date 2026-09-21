
// Account deletion — the caller's account and everything it owns, in one idempotent call.
//
// Two properties matter most. The Auth account goes last, because until it does the user can
// still authenticate and ask again, so a partial failure stays retryable. And the boundary
// between "mine" and "someone else's" has to hold: a design the user merely edits must survive
// them leaving it, while a design they own goes with them, co-editors' versions included.

import {describe, it, expect, beforeEach} from 'vitest'

import {handle_delete_account} from '../../server/src/account.ts'
import {QUOTA_COLLECTIONS} from '../../server/src/quota.ts'
import {admin_db, admin_auth, reset_firestore, reset_storage, reset_auth, put_object,
    object_exists, list_paths, design_doc, version_doc, upload_image, passage_with_image,
    new_id, at_later_time, PAST_SWEEP_GRACE_MS, EDITOR} from '../helpers/server.ts'

import type {DeletionSummary} from '../../server/src/account.ts'


let user:string


beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
    await reset_auth()
    user = (await admin_auth.createUser({})).uid
})


async function make_design(
        overrides:Record<string, unknown>|((id:string) => Record<string, unknown>) = {},
):Promise<string>{
    const id = new_id()
    await admin_db.doc(`designs/${id}`).set(
        design_doc(typeof overrides === 'function' ? overrides(id) : overrides))
    return id
}


async function make_version(design_id:string,
        overrides:Record<string, unknown> = {}):Promise<string>{
    const id = new_id()
    await admin_db.doc(`versions/${id}`).set(
        version_doc(design_id, {pdf_path: `versions/${id}/doc.pdf`, ...overrides}))
    return id
}


// The summary a deletion reports back
function summary(body:unknown):DeletionSummary {
    return body as DeletionSummary
}


describe('owned designs', () => {

    it('destroys them and reports the count', async () => {
        const a = await make_design({owner: user, editor_uids: [user]})
        const b = await make_design({owner: user, editor_uids: [user]})
        const result = await handle_delete_account(user)
        expect(result.status).toBe(200)
        expect(summary(result.body).designs).toBe(2)
        expect((await admin_db.doc(`designs/${a}`).get()).exists).toBe(false)
        expect((await admin_db.doc(`designs/${b}`).get()).exists).toBe(false)
    })

    it('takes co-editors\' versions with the design', async () => {
        // The same decision handle_delete_design makes — the alternative would leave the
        // departing user's content on the service after they asked for it to be gone
        const id = await make_design({owner: user, editor_uids: [user, EDITOR]})
        const theirs = await make_version(id, {owner: EDITOR})
        await handle_delete_account(user)
        expect((await admin_db.doc(`versions/${theirs}`).get()).exists).toBe(false)
    })

    it('removes every asset prefix and rendered PDF', async () => {
        const id = await make_design({owner: user, editor_uids: [user]})
        const version_id = await make_version(id, {owner: user})
        await put_object(`versions/${version_id}/doc.pdf`, 'application/pdf')
        await put_object(`design_assets/${id}/a.png`)
        await put_object(`version_assets/${id}/a.png`)
        await put_object(`design_cache/${id}/a.png`)

        await handle_delete_account(user)
        for (const prefix of [`versions/${version_id}/`, `design_assets/${id}/`,
            `version_assets/${id}/`, `design_cache/${id}/`]){
            expect(await list_paths(prefix)).toEqual([])
        }
    })
})


describe('designs owned by someone else', () => {

    it('leaves the design but drops the membership', async () => {
        const id = await make_design({owner: EDITOR, editor_uids: [EDITOR, user],
            editors: {[user]: {joined: new Date()}}})
        const result = await handle_delete_account(user)
        expect(summary(result.body).left).toBe(1)

        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data).toBeDefined()
        expect(data!['editor_uids']).toEqual([EDITOR])
        expect(user in (data!['editors'] as Record<string, unknown>)).toBe(false)
    })

    it('removes the user\'s own versions from it, keeping the owner\'s', async () => {
        const id = await make_design({owner: EDITOR, editor_uids: [EDITOR, user]})
        const mine = await make_version(id, {owner: user})
        const theirs = await make_version(id, {owner: EDITOR})
        const result = await handle_delete_account(user)
        expect(summary(result.body).versions).toBe(1)
        expect((await admin_db.doc(`versions/${mine}`).get()).exists).toBe(false)
        expect((await admin_db.doc(`versions/${theirs}`).get()).exists).toBe(true)
    })

    it('keeps their assets, sweeping only snapshots nothing still needs', async () => {
        const id = await make_design({owner: EDITOR, editor_uids: [EDITOR, user]})
        await put_object(`version_assets/${id}/only_mine.png`)
        await put_object(`version_assets/${id}/shared.png`)
        await put_object(`design_assets/${id}/live.png`)

        await make_version(id, {owner: EDITOR, blueprint: {content: [passage_with_image('p1',
            upload_image(`version_assets/${id}/shared.png`))]}})
        await make_version(id, {owner: user, blueprint: {content: [passage_with_image('p1',
            upload_image(`version_assets/${id}/only_mine.png`))]}})

        await at_later_time(PAST_SWEEP_GRACE_MS, () => handle_delete_account(user))
        expect(await object_exists(`version_assets/${id}/only_mine.png`)).toBe(false)
        expect(await object_exists(`version_assets/${id}/shared.png`)).toBe(true)
        expect(await object_exists(`design_assets/${id}/live.png`)).toBe(true)
    })

    it('repoints the design\'s summary when it described a deleted version', async () => {
        const id = await make_design({owner: EDITOR, editor_uids: [EDITOR, user],
            latest_version: {status: 'available', pages: 120, save_token: 'tok_mine'}})
        await make_version(id, {owner: EDITOR, save_token: 'tok_theirs', pages: 80,
            created: new Date(Date.now() - 10_000)})
        await make_version(id, {owner: user, save_token: 'tok_mine', pages: 120})

        await handle_delete_account(user)
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect((data!['latest_version'] as {save_token:string}).save_token).toBe('tok_theirs')
    })

    it('clears the summary when no version survives', async () => {
        const id = await make_design({owner: EDITOR, editor_uids: [EDITOR, user],
            latest_version: {status: 'available', pages: 120, save_token: 'tok_mine'}})
        await make_version(id, {owner: user, save_token: 'tok_mine'})
        await handle_delete_account(user)
        expect((await admin_db.doc(`designs/${id}`).get()).data()!['latest_version']).toBe(null)
    })
})


describe('user records', () => {

    it('removes the profile and read-access history', async () => {
        await admin_db.doc(`users/${user}`).set({print_warning_seen: true})
        await admin_db.doc(`users/${user}/viewed/d1`).set({design_id: 'd1'})
        await handle_delete_account(user)
        expect((await admin_db.doc(`users/${user}`).get()).exists).toBe(false)
        expect((await admin_db.doc(`users/${user}/viewed/d1`).get()).exists).toBe(false)
    })

    it('clears every quota counter, so a new collection cannot be forgotten here', async () => {
        for (const collection of QUOTA_COLLECTIONS){
            await admin_db.doc(`${collection}/${user}`).set({day: '2026-01-01', count: 5})
        }
        await handle_delete_account(user)
        for (const collection of QUOTA_COLLECTIONS){
            expect((await admin_db.doc(`${collection}/${user}`).get()).exists).toBe(false)
        }
    })

    it('removes the user\'s compile telemetry rows', async () => {
        await admin_db.collection('compile_stats').add({owner: user, runtime_ms: 1})
        await admin_db.collection('compile_stats').add({owner: EDITOR, runtime_ms: 1})
        await handle_delete_account(user)
        const mine = await admin_db.collection('compile_stats')
            .where('owner', '==', user).get()
        const theirs = await admin_db.collection('compile_stats')
            .where('owner', '==', EDITOR).get()
        expect(mine.empty).toBe(true)
        expect(theirs.empty).toBe(false)
    })

    it('leaves error reports alone — they are keyed by fingerprint, not by uid', async () => {
        await put_object('errors/abc123/report.json', 'application/json')
        await handle_delete_account(user)
        expect(await object_exists('errors/abc123/report.json')).toBe(true)
    })
})


describe('the auth account', () => {

    it('goes last, and goes', async () => {
        await handle_delete_account(user)
        await expect(admin_auth.getUser(user)).rejects.toThrow()
    })

    it('is idempotent — a retry after the account is gone still succeeds', async () => {
        await handle_delete_account(user)
        const result = await handle_delete_account(user)
        expect(result.status).toBe(200)
        expect(result.body).toEqual({ok: true, designs: 0, versions: 0, left: 0})
    })

    it('reports all zeroes for an account that owned nothing', async () => {
        const result = await handle_delete_account(user)
        expect(result.body).toEqual({ok: true, designs: 0, versions: 0, left: 0})
    })
})
