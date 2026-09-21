
// Security-rule tests for firestore.rules.
//
// These are the only thing standing between "knows a design id" and "can read/edit that design",
// and between a version's frozen blueprint and a co-editor who wants to change what was published.
// Everything here is asserted from a *client* context — the server bypasses rules via the Admin
// SDK, so anything the server does is covered by the server suite instead.

import {assertSucceeds, assertFails} from '@firebase/rules-unit-testing'
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where,
    serverTimestamp, addDoc, Timestamp} from 'firebase/firestore'
import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest'

import {make_test_env, db_for, seed, design_data, version_data, OWNER, EDITOR, STRANGER}
    from '../helpers/emulator.js'

import type {RulesTestEnvironment} from '@firebase/rules-unit-testing'


let env:RulesTestEnvironment


beforeAll(async () => {
    env = await make_test_env()
})

afterAll(async () => {
    await env.cleanup()
})

beforeEach(async () => {
    await env.clearFirestore()
})


describe('users', () => {

    it('lets a user read and write their own profile', async () => {
        const db = db_for(env, OWNER)
        await assertSucceeds(setDoc(doc(db, `users/${OWNER}`), {print_warning_seen: true}))
        await assertSucceeds(getDoc(doc(db, `users/${OWNER}`)))
    })

    it('denies reading another user\'s profile', async () => {
        await seed(env, [{path: `users/${OWNER}`, data: {print_warning_seen: true}}])
        await assertFails(getDoc(doc(db_for(env, STRANGER), `users/${OWNER}`)))
    })

    it('denies writing another user\'s profile', async () => {
        await assertFails(
            setDoc(doc(db_for(env, STRANGER), `users/${OWNER}`), {print_warning_seen: true}))
    })

    it('denies a signed-out caller entirely', async () => {
        await assertFails(getDoc(doc(db_for(env, null), `users/${OWNER}`)))
    })

    describe('viewed subcollection', () => {

        it('lets a user record and read their own read-access history', async () => {
            const db = db_for(env, OWNER)
            const path = `users/${OWNER}/viewed/design_main`
            await assertSucceeds(setDoc(doc(db, path), {design_id: 'design_main',
                title: 'Genesis', last_version_id: 'v1', last_viewed: serverTimestamp()}))
            await assertSucceeds(getDoc(doc(db, path)))
        })

        it('denies reading another user\'s history — it names designs they have opened', async () => {
            await seed(env, [{path: `users/${OWNER}/viewed/design_main`,
                data: {design_id: 'design_main', title: 'Genesis'}}])
            await assertFails(
                getDoc(doc(db_for(env, STRANGER), `users/${OWNER}/viewed/design_main`)))
        })

        it('denies writing into another user\'s history', async () => {
            await assertFails(setDoc(
                doc(db_for(env, STRANGER), `users/${OWNER}/viewed/x`), {design_id: 'x'}))
        })
    })
})


describe('designs', () => {

    describe('create', () => {

        it('lets a signed-in user create a design they own and edit', async () => {
            await assertSucceeds(setDoc(
                doc(db_for(env, OWNER), 'designs/design_new'), design_data()))
        })

        it('denies a signed-out caller', async () => {
            await assertFails(setDoc(
                doc(db_for(env, null), 'designs/design_new'), design_data()))
        })

        it('denies creating a design owned by someone else', async () => {
            // Otherwise anyone could plant designs into another account
            await assertFails(setDoc(doc(db_for(env, STRANGER), 'designs/design_new'),
                design_data({owner: OWNER, editor_uids: [OWNER]})))
        })

        it('denies creating a design the creator is not an editor of', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'designs/design_new'),
                design_data({editor_uids: []})))
        })

        it('denies planting extra editors at create time', async () => {
            // editor_uids must contain the creator, but nothing stops them listing others too —
            // this documents that, since those users can still only *read* what they were added
            // to and the owner could have invited them anyway
            await assertSucceeds(setDoc(doc(db_for(env, OWNER), 'designs/design_new'),
                design_data({editor_uids: [OWNER, EDITOR]})))
        })
    })

    describe('read', () => {

        beforeEach(async () => {
            await seed(env, [{path: 'designs/design_main',
                data: design_data({editor_uids: [OWNER, EDITOR]})}])
        })

        it('lets the owner read', async () => {
            await assertSucceeds(getDoc(doc(db_for(env, OWNER), 'designs/design_main')))
        })

        it('lets an invited editor read', async () => {
            await assertSucceeds(getDoc(doc(db_for(env, EDITOR), 'designs/design_main')))
        })

        it('denies a stranger who knows the id', async () => {
            // The id alone is not a capability for a design — editing is a permission grant, so
            // an invite link carries a separate share_token the server validates
            await assertFails(getDoc(doc(db_for(env, STRANGER), 'designs/design_main')))
        })

        it('denies a signed-out caller', async () => {
            await assertFails(getDoc(doc(db_for(env, null), 'designs/design_main')))
        })

        it('lets any signed-in caller read a design id that does not exist', async () => {
            // Deliberate: an open design's listener has to be able to observe its own deletion,
            // and `resource.data` on a missing doc raises rather than evaluating false. Ids are
            // unguessable, so "nothing here" tells a caller who already had the id nothing new
            const snap = await assertSucceeds(
                getDoc(doc(db_for(env, STRANGER), 'designs/design_absent')))
            expect(snap.exists()).toBe(false)
        })

        it('denies listing the collection', async () => {
            // The app queries by editor_uids; a bare dump would enumerate every design
            await assertFails(getDocs(collection(db_for(env, OWNER), 'designs')))
        })

        it('allows a query scoped to the caller\'s own editorship', async () => {
            await assertSucceeds(getDocs(query(collection(db_for(env, OWNER), 'designs'),
                where('editor_uids', 'array-contains', OWNER))))
        })

        it('denies a query scoped to someone else\'s editorship', async () => {
            await assertFails(getDocs(query(collection(db_for(env, STRANGER), 'designs'),
                where('editor_uids', 'array-contains', OWNER))))
        })
    })

    describe('update', () => {

        beforeEach(async () => {
            await seed(env, [{path: 'designs/design_main',
                data: design_data({editor_uids: [OWNER, EDITOR], editors: {[EDITOR]: {joined: Timestamp.now()}}})}])
        })

        it('lets an editor change content', async () => {
            await assertSucceeds(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {'blueprint.font_size': 12, modified: serverTimestamp()}))
        })

        it('lets an editor add a content item', async () => {
            await assertSucceeds(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {'content_items.item1': {type: 'title', id: 'item1', title: 'Hi',
                    title_subtitle: '', title_icon: null}, content_order: ['item1']}))
        })

        it('denies a stranger', async () => {
            await assertFails(updateDoc(
                doc(db_for(env, STRANGER), 'designs/design_main'), {name: 'Stolen'}))
        })

        it('denies a signed-out caller', async () => {
            await assertFails(updateDoc(
                doc(db_for(env, null), 'designs/design_main'), {name: 'Stolen'}))
        })

        it('denies anyone changing the owner, including the owner', async () => {
            await assertFails(updateDoc(
                doc(db_for(env, OWNER), 'designs/design_main'), {owner: EDITOR}))
            await assertFails(updateDoc(
                doc(db_for(env, EDITOR), 'designs/design_main'), {owner: EDITOR}))
        })

        // Membership and sharing are the owner's alone — an invited editor who could edit
        // editor_uids could invite anyone, or lock the owner out of their own design
        it('denies an editor adding another editor', async () => {
            await assertFails(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {editor_uids: [OWNER, EDITOR, STRANGER]}))
        })

        it('denies an editor removing the owner', async () => {
            await assertFails(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {editor_uids: [EDITOR]}))
        })

        it('denies an editor rotating the share token', async () => {
            await assertFails(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {share_token: 'attacker_chosen'}))
        })

        it('denies an editor rewriting the editors map', async () => {
            await assertFails(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {[`editors.${STRANGER}`]: {joined: Timestamp.now()}}))
        })

        it('lets the owner manage membership and sharing', async () => {
            const db = db_for(env, OWNER)
            await assertSucceeds(updateDoc(doc(db, 'designs/design_main'),
                {editor_uids: [OWNER], [`editors.${EDITOR}`]: null}))
            await assertSucceeds(updateDoc(doc(db, 'designs/design_main'),
                {share_token: 'rotated_by_owner'}))
            await assertSucceeds(updateDoc(doc(db, 'designs/design_main'),
                {share_token: null}))
        })

        it('denies an editor granting themselves ownership via editor_uids alone', async () => {
            await assertFails(updateDoc(doc(db_for(env, EDITOR), 'designs/design_main'),
                {editor_uids: [EDITOR, OWNER], owner: EDITOR}))
        })
    })

    describe('delete', () => {

        it('denies everyone, owner included — deletion is server-mediated', async () => {
            // The server has to remove Storage objects clients can't touch, and versions
            // belonging to other editors
            await seed(env, [{path: 'designs/design_main', data: design_data()}])
            await assertFails(deleteDoc(doc(db_for(env, OWNER), 'designs/design_main')))
            await assertFails(deleteDoc(doc(db_for(env, EDITOR), 'designs/design_main')))
            await assertFails(deleteDoc(doc(db_for(env, STRANGER), 'designs/design_main')))
        })
    })
})


describe('versions', () => {

    beforeEach(async () => {
        await seed(env, [{path: 'designs/design_main',
            data: design_data({editor_uids: [OWNER, EDITOR]})}])
    })

    describe('create', () => {

        it('lets an editor of the parent design create a pending version', async () => {
            await assertSucceeds(setDoc(doc(db_for(env, EDITOR), 'versions/v_new'),
                version_data('v_new', {owner: EDITOR})))
        })

        it('denies a stranger creating one against a design they cannot edit', async () => {
            await assertFails(setDoc(doc(db_for(env, STRANGER), 'versions/v_new'),
                version_data('v_new', {owner: STRANGER})))
        })

        it('denies attaching a version to a design that does not exist', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {design_id: 'design_absent'})))
        })

        it('denies creating a version owned by someone else', async () => {
            await assertFails(setDoc(doc(db_for(env, EDITOR), 'versions/v_new'),
                version_data('v_new', {owner: OWNER})))
        })

        // Lifecycle fields are pinned at create so they can't be forged: the server trusts
        // pdf_path by convention, and viewers trust created-ordering for "latest version"
        it('denies creating a version that claims to be already available', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {status: 'available', pages: 100})))
        })

        it('denies a backdated or forward-dated created timestamp', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {created: Timestamp.fromMillis(0)})))
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new',
                    {created: Timestamp.fromMillis(Date.now() + 86_400_000)})))
        })

        it('denies a pdf_path pointing at another version\'s object', async () => {
            // Otherwise a crafted doc could aim a regeneration's upload at someone else's PDF
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {pdf_path: 'versions/v_someone_else/doc.pdf'})))
        })

        it('denies a pdf_path pointing outside the versions prefix', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {pdf_path: 'design_assets/design_main/evil.pdf'})))
        })

        it('denies a non-map blueprint', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {blueprint: 'not a map'})))
        })

        it('denies a missing save_token', async () => {
            // The design's has-unrendered-changes check compares this by equality
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_new'),
                version_data('v_new', {save_token: null})))
        })
    })

    describe('read', () => {

        beforeEach(async () => {
            await seed(env, [
                {path: 'versions/v_main', data: {...version_data('v_main'),
                    status: 'available', pages: 120, created: Timestamp.now()}},
                {path: 'versions/v_other', data: {...version_data('v_other'),
                    design_id: 'design_other', created: Timestamp.now()}},
            ])
        })

        it('lets anyone with the id read a version, signed out included', async () => {
            // The id is an unguessable url64 token and is the whole capability — sharing a
            // version is just sharing its URL
            await assertSucceeds(getDoc(doc(db_for(env, STRANGER), 'versions/v_main')))
            await assertSucceeds(getDoc(doc(db_for(env, null), 'versions/v_main')))
        })

        it('denies listing the collection', async () => {
            await assertFails(getDocs(collection(db_for(env, OWNER), 'versions')))
        })

        it('allows a list pinned to one design with an equality filter', async () => {
            const snap = await assertSucceeds(getDocs(query(
                collection(db_for(env, OWNER), 'versions'),
                where('design_id', '==', 'design_main'))))
            expect(snap.docs.map(d => d.id)).toEqual(['v_main'])
        })

        it('denies a list filtered by owner instead of design', async () => {
            // Otherwise a caller could enumerate everything a given account ever published
            await assertFails(getDocs(query(collection(db_for(env, OWNER), 'versions'),
                where('owner', '==', OWNER))))
        })

        it('denies an inequality filter on design_id', async () => {
            await assertFails(getDocs(query(collection(db_for(env, OWNER), 'versions'),
                where('design_id', '>', ''))))
        })
    })

    describe('update', () => {

        beforeEach(async () => {
            await seed(env, [{path: 'versions/v_main',
                data: {...version_data('v_main'), created: Timestamp.now()}}])
        })

        it('lets the owner record the outcome of their own compile', async () => {
            await assertSucceeds(updateDoc(doc(db_for(env, OWNER), 'versions/v_main'),
                {status: 'available', pages: 120,
                    pdf_expires: Timestamp.fromMillis(Date.now() + 1000)}))
        })

        it('lets the owner record a failure', async () => {
            await assertSucceeds(updateDoc(doc(db_for(env, OWNER), 'versions/v_main'),
                {status: 'failed', error: 'out of memory', error_id: 'err1'}))
        })

        it('denies a co-editor of the parent design', async () => {
            // Versions belong to whoever compiled them, not to the design's editor set
            await assertFails(updateDoc(
                doc(db_for(env, EDITOR), 'versions/v_main'), {status: 'available'}))
        })

        it('denies a stranger who knows the id', async () => {
            // Public read by id must not imply public write by id
            await assertFails(updateDoc(
                doc(db_for(env, STRANGER), 'versions/v_main'), {status: 'available'}))
            await assertFails(updateDoc(
                doc(db_for(env, null), 'versions/v_main'), {status: 'available'}))
        })

        const immutable:Record<string, unknown> = {
            blueprint: {font_size: 99},
            owner: STRANGER,
            created: Timestamp.fromMillis(0),
            design_id: 'design_other',
            copied_from: 'v_elsewhere',
            custom_fonts: [{family: 'X', style: 'normal', files: []}],
            save_token: 'forged',
            wizard_draft: {step: 1},
            simple_mode: true,
            pdf_path: 'versions/v_other/doc.pdf',
            title: 'Retitled',
            cover_render_version: 99,
            schema: 99,
        }

        for (const [field, value] of Object.entries(immutable)){
            it(`denies the owner changing ${field}`, async () => {
                await assertFails(updateDoc(
                    doc(db_for(env, OWNER), 'versions/v_main'), {[field]: value}))
            })
        }

        it('denies smuggling an immutable field alongside a permitted one', async () => {
            await assertFails(updateDoc(doc(db_for(env, OWNER), 'versions/v_main'),
                {status: 'available', blueprint: {font_size: 99}}))
        })

        it('denies deleting an immutable field rather than changing it', async () => {
            await assertFails(setDoc(doc(db_for(env, OWNER), 'versions/v_main'),
                {status: 'available'}))
        })
    })

    describe('delete', () => {

        it('denies everyone — the PDFs and snapshots have to go with the doc', async () => {
            await seed(env, [{path: 'versions/v_main',
                data: {...version_data('v_main'), created: Timestamp.now()}}])
            await assertFails(deleteDoc(doc(db_for(env, OWNER), 'versions/v_main')))
            await assertFails(deleteDoc(doc(db_for(env, STRANGER), 'versions/v_main')))
        })
    })
})


describe('compile_stats', () => {

    it('lets a signed-in user record their own compile attempt', async () => {
        await assertSucceeds(addDoc(collection(db_for(env, OWNER), 'compile_stats'),
            {owner: OWNER, runtime_ms: 1200, expires: Timestamp.now()}))
    })

    it('denies attributing a stat to another user', async () => {
        await assertFails(addDoc(collection(db_for(env, STRANGER), 'compile_stats'),
            {owner: OWNER, runtime_ms: 1200}))
    })

    it('denies a signed-out caller', async () => {
        await assertFails(addDoc(collection(db_for(env, null), 'compile_stats'),
            {owner: OWNER, runtime_ms: 1200}))
    })

    it('is write-only: no read, update or delete', async () => {
        await seed(env, [{path: 'compile_stats/stat1', data: {owner: OWNER, runtime_ms: 1}}])
        const db = db_for(env, OWNER)
        await assertFails(getDoc(doc(db, 'compile_stats/stat1')))
        await assertFails(getDocs(collection(db, 'compile_stats')))
        await assertFails(updateDoc(doc(db, 'compile_stats/stat1'), {runtime_ms: 2}))
        await assertFails(deleteDoc(doc(db, 'compile_stats/stat1')))
    })
})


describe('quota collections', () => {

    // These match no rule at all, which is what stops a caller reading or resetting their own
    // count — worth asserting, since adding a rule for them would silently undo that

    for (const collection_id of ['compile_quota', 'copy_quota']){
        it(`denies the owning user reading or writing their ${collection_id} row`, async () => {
            await seed(env, [{path: `${collection_id}/${OWNER}`,
                data: {day: '2026-01-01', count: 5}}])
            const db = db_for(env, OWNER)
            await assertFails(getDoc(doc(db, `${collection_id}/${OWNER}`)))
            await assertFails(setDoc(doc(db, `${collection_id}/${OWNER}`),
                {day: '2026-01-01', count: 0}))
            await assertFails(deleteDoc(doc(db, `${collection_id}/${OWNER}`)))
        })
    }
})


describe('undeclared collections', () => {

    it('denies reads and writes to any path no rule covers', async () => {
        const db = db_for(env, OWNER)
        await assertFails(setDoc(doc(db, 'arbitrary/doc1'), {a: 1}))
        await assertFails(getDoc(doc(db, 'arbitrary/doc1')))
        await assertFails(setDoc(doc(db, 'designs/design_main/secrets/s1'), {a: 1}))
    })
})
