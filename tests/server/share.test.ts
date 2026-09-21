
// Design invite redemption and "keep own copy".
//
// Two different capability models meet here. A design id is *not* a capability — editing is a
// permission grant, so an invite link carries a separate share_token this server validates before
// adding anyone to editor_uids. A version id *is* the whole capability, so copying one needs no
// check beyond the version existing. Most of what follows is about the copy staying inside the
// boundaries of what the caller was actually shown.

import {describe, it, expect, beforeEach} from 'vitest'

import {handle_design_invite_preview, handle_redeem_design_invite, handle_design_editors,
    handle_copy_version} from '../../server/src/share.ts'
import {QUOTA_COPY} from '../../server/src/quota.ts'
import {admin_db, reset_firestore, reset_storage, reset_auth, put_object, object_exists,
    list_paths, design_doc, version_doc, upload_image, passage_with_image, new_id,
    OWNER, EDITOR, STRANGER} from '../helpers/server.ts'


beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
})


// Write a design and return its id
async function make_design(overrides:Record<string, unknown> = {}):Promise<string>{
    const id = new_id()
    await admin_db.doc(`designs/${id}`).set(design_doc(overrides))
    return id
}


// Write a version of a design and return its id
async function make_version(design_id:string,
        overrides:Record<string, unknown> = {}):Promise<string>{
    const id = new_id()
    await admin_db.doc(`versions/${id}`).set(
        version_doc(design_id, {pdf_path: `versions/${id}/doc.pdf`, ...overrides}))
    return id
}


describe('handle_design_invite_preview', () => {

    it('returns the design name for a valid token', async () => {
        const id = await make_design({name: 'Family Bible'})
        const result = await handle_design_invite_preview(id, 'share_token_value')
        expect(result.status).toBe(200)
        expect(result.body).toEqual({name: 'Family Bible'})
    })

    it('falls back to the cover title, then the derived name', async () => {
        const with_cover = await make_design({name: '',
            blueprint: {cover: {form: {title1: 'Cover', title2: 'Title'}, bg_image: null,
                font_families: [], title_custom: false}}})
        expect((await handle_design_invite_preview(with_cover, 'share_token_value')).body)
            .toEqual({name: 'Cover Title'})

        const bare = await make_design({name: '', name_auto: 'Genesis 1-3'})
        expect((await handle_design_invite_preview(bare, 'share_token_value')).body)
            .toEqual({name: 'Genesis 1-3'})
    })

    it('grants no access — previewing does not add the viewer as an editor', async () => {
        const id = await make_design()
        await handle_design_invite_preview(id, 'share_token_value')
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data!['editor_uids']).toEqual([OWNER])
    })

    it('refuses a wrong token', async () => {
        const id = await make_design()
        const result = await handle_design_invite_preview(id, 'wrong_token')
        expect(result.status).toBe(404)
    })

    it('refuses a prefix of the real token', async () => {
        const id = await make_design()
        expect((await handle_design_invite_preview(id, 'share_token_valu')).status).toBe(404)
        expect((await handle_design_invite_preview(id, 'share_token_value_extra')).status)
            .toBe(404)
    })

    it('refuses an empty token', async () => {
        const id = await make_design()
        expect((await handle_design_invite_preview(id, '')).status).toBe(404)
    })

    it('refuses when sharing is disabled, even with a matching empty value', async () => {
        // share_token null/'' means "not shared" — it must never be matchable
        for (const share_token of [null, '']){
            const id = await make_design({share_token})
            expect((await handle_design_invite_preview(id, '')).status).toBe(404)
            expect((await handle_design_invite_preview(id, 'null')).status).toBe(404)
        }
    })

    it('gives the same answer for a missing design as for a bad token', async () => {
        const missing = await handle_design_invite_preview(new_id(), 'share_token_value')
        const bad = await handle_design_invite_preview(await make_design(), 'nope')
        expect(missing).toEqual(bad)
    })
})


describe('handle_redeem_design_invite', () => {

    it('adds the caller as an editor', async () => {
        const id = await make_design()
        const result = await handle_redeem_design_invite(STRANGER, id, 'share_token_value')
        expect(result.status).toBe(200)
        const data = (await admin_db.doc(`designs/${id}`).get()).data()
        expect(data!['editor_uids']).toEqual([OWNER, STRANGER])
        expect((data!['editors'] as Record<string, unknown>)[STRANGER]).toBeDefined()
    })

    it('does not grant ownership', async () => {
        const id = await make_design()
        await handle_redeem_design_invite(STRANGER, id, 'share_token_value')
        expect((await admin_db.doc(`designs/${id}`).get()).data()!['owner']).toBe(OWNER)
    })

    it('is idempotent — redeeming twice adds one entry', async () => {
        const id = await make_design()
        await handle_redeem_design_invite(STRANGER, id, 'share_token_value')
        await handle_redeem_design_invite(STRANGER, id, 'share_token_value')
        expect((await admin_db.doc(`designs/${id}`).get()).data()!['editor_uids'])
            .toEqual([OWNER, STRANGER])
    })

    it('leaves the owner\'s own membership alone when they redeem their own link', async () => {
        const id = await make_design()
        await handle_redeem_design_invite(OWNER, id, 'share_token_value')
        expect((await admin_db.doc(`designs/${id}`).get()).data()!['editor_uids'])
            .toEqual([OWNER])
    })

    it('refuses a wrong token and grants nothing', async () => {
        const id = await make_design()
        const result = await handle_redeem_design_invite(STRANGER, id, 'wrong_token')
        expect(result.status).toBe(404)
        expect((await admin_db.doc(`designs/${id}`).get()).data()!['editor_uids'])
            .toEqual([OWNER])
    })

    it('refuses once the owner has revoked sharing', async () => {
        const id = await make_design({share_token: null})
        expect((await handle_redeem_design_invite(STRANGER, id, 'share_token_value')).status)
            .toBe(404)
    })

    it('refuses a design that does not exist', async () => {
        expect((await handle_redeem_design_invite(STRANGER, new_id(), 'share_token_value'))
            .status).toBe(404)
    })

    it('does not accept another design\'s token', async () => {
        await make_design({share_token: 'token_of_design_a'})
        const target = await make_design({share_token: 'token_of_design_b'})
        expect((await handle_redeem_design_invite(STRANGER, target, 'token_of_design_a')).status)
            .toBe(404)
    })
})


describe('handle_design_editors', () => {

    beforeEach(async () => {
        await reset_auth()
    })

    it('lists the owner and editors, flagging the owner', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        const result = await handle_design_editors(OWNER, id)
        expect(result.status).toBe(200)
        const editors = (result.body as {editors:{uid:string, owner:boolean}[]}).editors
        expect(editors.map(e => e.uid)).toEqual([OWNER, EDITOR])
        expect(editors.map(e => e.owner)).toEqual([true, false])
    })

    it('lets a non-owner editor see the list too', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        expect((await handle_design_editors(EDITOR, id)).status).toBe(200)
    })

    it('refuses a caller who is not an editor', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        const result = await handle_design_editors(STRANGER, id)
        expect(result.status).toBe(404)
        expect(result.body).toEqual({error: 'not_found'})
    })

    it('refuses a design that does not exist', async () => {
        expect((await handle_design_editors(OWNER, new_id())).status).toBe(404)
    })

    it('reports null name and email for a uid with no auth record', async () => {
        // An account can be deleted while still listed on a design; the dialog must still render
        const id = await make_design()
        const editors = (await handle_design_editors(OWNER, id)).body as
            {editors:{name:string|null, email:string|null}[]}
        expect(editors.editors[0]).toMatchObject({name: null, email: null})
    })
})


describe('handle_copy_version', () => {

    it('refuses a version that does not exist', async () => {
        const result = await handle_copy_version(STRANGER, new_id())
        expect(result.status).toBe(404)
    })

    it('refuses a version still compiling', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id, {status: 'pending'})
        const result = await handle_copy_version(STRANGER, version_id)
        expect(result.status).toBe(409)
        expect(result.body).toEqual({error: 'still_pending'})
    })

    it('costs the caller no quota when the version is missing or pending', async () => {
        const design_id = await make_design()
        const pending = await make_version(design_id, {status: 'pending'})
        await handle_copy_version(STRANGER, pending)
        await handle_copy_version(STRANGER, new_id())
        expect((await admin_db.doc(`${QUOTA_COPY}/${STRANGER}`).get()).exists).toBe(false)
    })

    it('creates a design and a version owned by the caller', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        const result = await handle_copy_version(STRANGER, version_id)
        expect(result.status).toBe(200)

        const ids = result.body as {design_id:string, version_id:string}
        const new_design = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
        const new_version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
        expect(new_design!['owner']).toBe(STRANGER)
        expect(new_design!['editor_uids']).toEqual([STRANGER])
        expect(new_version!['owner']).toBe(STRANGER)
        expect(new_version!['design_id']).toBe(ids.design_id)
        expect(new_version!['copied_from']).toBe(version_id)
    })

    it('gives the copy a fresh share token of its own', async () => {
        const design_id = await make_design({share_token: 'original_token'})
        const version_id = await make_version(design_id)
        const ids = (await handle_copy_version(STRANGER, version_id)).body as {design_id:string}
        const copy = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
        expect(copy!['share_token']).toBeTruthy()
        expect(copy!['share_token']).not.toBe('original_token')
    })

    it('lands with no unrendered changes — design and version share one save_token', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        const ids = (await handle_copy_version(STRANGER, version_id)).body as
            {design_id:string, version_id:string}
        const design = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
        const version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
        expect(design!['save_token']).toBe(version!['save_token'])
        expect((design!['latest_version'] as {save_token:string}).save_token)
            .toBe(version!['save_token'])
        // And not the source's, which the recipient has no reason to inherit
        expect(design!['save_token']).not.toBe('save_token_value')
    })

    it('leaves the source untouched', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        const before = (await admin_db.doc(`versions/${version_id}`).get()).data()
        await handle_copy_version(STRANGER, version_id)
        const after = (await admin_db.doc(`versions/${version_id}`).get()).data()
        expect(after).toEqual(before)
    })

    it('copies the PDFs to the new version\'s own paths', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id, {cover_status: 'available'})
        await put_object(`versions/${version_id}/doc.pdf`, 'application/pdf')
        await put_object(`versions/${version_id}/cover.pdf`, 'application/pdf')

        const ids = (await handle_copy_version(STRANGER, version_id)).body as {version_id:string}
        expect(await object_exists(`versions/${ids.version_id}/doc.pdf`)).toBe(true)
        expect(await object_exists(`versions/${ids.version_id}/cover.pdf`)).toBe(true)
    })

    it('derives the copy\'s pdf_path from its own id, never the source doc\'s field', async () => {
        // Doc fields are client-written; trusting pdf_path would let a crafted doc exfiltrate an
        // arbitrary bucket object into a publicly-gettable copy
        const design_id = await make_design()
        const version_id = await make_version(design_id,
            {pdf_path: 'design_assets/somebody_else/private.pdf'})
        const ids = (await handle_copy_version(STRANGER, version_id)).body as {version_id:string}
        const copy = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
        expect(copy!['pdf_path']).toBe(`versions/${ids.version_id}/doc.pdf`)
    })

    it('gives a copied PDF its own 365-day clock', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id,
            {pdf_expires: new Date(Date.now() + 1000)})
        await put_object(`versions/${version_id}/doc.pdf`, 'application/pdf')
        const ids = (await handle_copy_version(STRANGER, version_id)).body as {version_id:string}
        const copy = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
        expect((copy!['pdf_expires'] as {toMillis:() => number}).toMillis())
            .toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000)
    })

    it('keeps the source\'s expiry when the PDF has already been swept', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        const source_expiry = (await admin_db.doc(`versions/${version_id}`).get())
            .data()!['pdf_expires']
        const ids = (await handle_copy_version(STRANGER, version_id)).body as {version_id:string}
        const copy = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
        expect(copy!['pdf_expires']).toEqual(source_expiry)
        expect(await object_exists(`versions/${ids.version_id}/doc.pdf`)).toBe(false)
    })

    describe('asset scoping', () => {

        it('copies only the basenames this version references', async () => {
            // A design's version_assets prefix is shared by every version it ever had — copying
            // it wholesale would hand the recipient images from versions never shared with them
            const design_id = await make_design()
            const referenced = 'referenced.png'
            const other = 'from_another_version.png'
            await put_object(`version_assets/${design_id}/${referenced}`)
            await put_object(`version_assets/${design_id}/${other}`)

            const version_id = await make_version(design_id, {blueprint: {content: [
                passage_with_image('p1',
                    upload_image(`version_assets/${design_id}/${referenced}`))]}})

            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string}
            const copied = await list_paths(`version_assets/${ids.design_id}/`)
            expect(copied).toEqual([`version_assets/${ids.design_id}/${referenced}`])
        })

        it('gives the copy both a frozen snapshot and an editable design asset', async () => {
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/pic.png`)
            const version_id = await make_version(design_id, {blueprint: {content: [
                passage_with_image('p1', upload_image(`version_assets/${design_id}/pic.png`))]}})

            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string, version_id:string}
            expect(await object_exists(`version_assets/${ids.design_id}/pic.png`)).toBe(true)
            expect(await object_exists(`design_assets/${ids.design_id}/pic.png`)).toBe(true)

            // And the two blueprints point at their own prefix, not at each other's
            const version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
            const design = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
            const version_path = ((version!['blueprint'] as {content:{image:{path:string}}[]})
                .content[0]!.image.path)
            const design_path = ((design!['content_items'] as
                Record<string, {image:{path:string}}>)['p1']!.image.path)
            expect(version_path).toBe(`version_assets/${ids.design_id}/pic.png`)
            expect(design_path).toBe(`design_assets/${ids.design_id}/pic.png`)
        })

        it('never copies an asset from outside the source design\'s own prefix', async () => {
            const design_id = await make_design()
            await put_object('version_assets/somebody_else/secret.png')
            const version_id = await make_version(design_id, {blueprint: {content: [
                passage_with_image('p1',
                    upload_image('version_assets/somebody_else/secret.png'))]}})

            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string}
            // The basename is taken, but only ever looked for under the source's own prefix —
            // which has no such object, so nothing is copied
            expect(await list_paths(`version_assets/${ids.design_id}/`)).toEqual([])
            expect(await object_exists('version_assets/somebody_else/secret.png')).toBe(true)
        })

        it('re-paths font metadata onto the new design\'s prefixes', async () => {
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/font.bin`, 'font/otf')
            const version_id = await make_version(design_id, {custom_fonts: [
                {family: 'My Font', style: 'normal',
                    files: [`version_assets/${design_id}/font.bin`]}]})

            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string, version_id:string}
            const version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
            const design = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
            expect((version!['custom_fonts'] as {files:string[]}[])[0]!.files)
                .toEqual([`version_assets/${ids.design_id}/font.bin`])
            const design_fonts = Object.values(
                design!['fonts'] as Record<string, {family:string, files:string[]}>)
            expect(design_fonts).toHaveLength(1)
            expect(design_fonts[0]!.files)
                .toEqual([`design_assets/${ids.design_id}/font.bin`])
            expect(design_fonts[0]!.family).toBe('My Font')
        })

        it('drops a font entry pointing outside the source prefix rather than rewriting it', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id, {custom_fonts: [
                {family: 'Good', style: 'normal',
                    files: [`version_assets/${design_id}/ok.bin`]},
                {family: 'Hostile', style: 'normal',
                    files: ['version_assets/somebody_else/font.bin']},
                {family: 'Mixed', style: 'normal',
                    files: [`version_assets/${design_id}/ok.bin`,
                        'version_assets/somebody_else/font.bin']},
            ]})

            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {version_id:string}
            const version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
            const families = (version!['custom_fonts'] as {family:string}[]).map(f => f.family)
            expect(families).toEqual(['Good'])
        })

        it('survives a version whose referenced asset is already gone', async () => {
            // A source design deleted mid-copy loses a picture, which beats failing the copy
            const design_id = await make_design()
            const version_id = await make_version(design_id, {blueprint: {content: [
                passage_with_image('p1',
                    upload_image(`version_assets/${design_id}/missing.png`))]}})
            expect((await handle_copy_version(STRANGER, version_id)).status).toBe(200)
        })
    })

    describe('carried-over metadata', () => {

        it('keeps the frozen title, page count and status', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id,
                {title: 'Gospel of John', pages: 88, status: 'available'})
            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string, version_id:string}
            const version = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
            const design = (await admin_db.doc(`designs/${ids.design_id}`).get()).data()
            expect(version!['title']).toBe('Gospel of John')
            expect(version!['pages']).toBe(88)
            // The frozen title seeds the copy's content-derived name, so this service never
            // needs the Bible collection
            expect(design!['name_auto']).toBe('Gospel of John')
        })

        it('keeps the copy simple when the source was made by the wizard', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id,
                {simple_mode: true, wizard_draft: {step: 3}})
            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {design_id:string, version_id:string}
            for (const path of [`designs/${ids.design_id}`, `versions/${ids.version_id}`]){
                const data = (await admin_db.doc(path).get()).data()
                expect(data!['simple_mode']).toBe(true)
                expect(data!['wizard_draft']).toEqual({step: 3})
            }
        })

        it('carries the cover render version verbatim — the bytes are the source\'s', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id,
                {cover_status: 'available', cover_render_version: 7})
            const ids = (await handle_copy_version(STRANGER, version_id)).body as
                {version_id:string}
            const copy = (await admin_db.doc(`versions/${ids.version_id}`).get()).data()
            expect(copy!['cover_status']).toBe('available')
            expect(copy!['cover_render_version']).toBe(7)
        })
    })

    describe('quota', () => {

        it('counts a successful copy', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id)
            await handle_copy_version(STRANGER, version_id)
            const data = (await admin_db.doc(`${QUOTA_COPY}/${STRANGER}`).get()).data()
            expect(data!['count']).toBe(1)
        })

        it('refuses once the caller is over their daily cap', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id)
            // Seed the row at the cap rather than looping the (slow) real limit
            await admin_db.doc(`${QUOTA_COPY}/${STRANGER}`).set({
                day: new Date().toISOString().slice(0, 10),
                count: 10_000,
                expires: new Date(Date.now() + 1000),
            })
            const result = await handle_copy_version(STRANGER, version_id)
            expect(result.status).toBe(429)
            expect(result.body).toEqual({error: 'quota_exceeded'})
        })

        it('creates nothing when refused', async () => {
            const design_id = await make_design()
            const version_id = await make_version(design_id)
            await admin_db.doc(`${QUOTA_COPY}/${STRANGER}`).set({
                day: new Date().toISOString().slice(0, 10),
                count: 10_000,
                expires: new Date(Date.now() + 1000),
            })
            await handle_copy_version(STRANGER, version_id)
            const designs = await admin_db.collection('designs')
                .where('owner', '==', STRANGER).get()
            expect(designs.empty).toBe(true)
        })
    })
})
