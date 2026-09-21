
// Design lifecycle: deleting a design or a single version, and duplicating a design.
//
// All three exist server-side because clients have no delete rule on any Storage prefix, and
// because Firestore only lets a version's own creator delete it — so a shared design's co-editor
// versions would otherwise outlive the design. Both deletes are idempotent and remove the
// design/version doc *last*, so a partial failure leaves a retryable handle rather than orphans.

import {describe, it, expect, beforeEach} from 'vitest'

import {handle_delete_design, handle_delete_version, handle_duplicate_design}
    from '../../server/src/designs.ts'
import {admin_db, reset_firestore, reset_storage, put_object, object_exists, list_paths,
    design_doc, version_doc, upload_image, passage_with_image, new_id, at_later_time,
    PAST_SWEEP_GRACE_MS, OWNER, EDITOR, STRANGER} from '../helpers/server.ts'


beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
})


async function make_design(
        overrides:Record<string, unknown>|((id:string) => Record<string, unknown>) = {},
):Promise<string>{
    // The id is generated first so a fixture can build asset paths that reference it
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


describe('handle_delete_design', () => {

    it('removes the design doc', async () => {
        const id = await make_design()
        expect((await handle_delete_design(OWNER, id)).status).toBe(200)
        expect((await admin_db.doc(`designs/${id}`).get()).exists).toBe(false)
    })

    it('removes every version, including a co-editor\'s', async () => {
        // The client rules only let an owner delete their own versions, which is exactly why
        // this has to happen here
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        const mine = await make_version(id)
        const theirs = await make_version(id, {owner: EDITOR})
        await handle_delete_design(OWNER, id)
        expect((await admin_db.doc(`versions/${mine}`).get()).exists).toBe(false)
        expect((await admin_db.doc(`versions/${theirs}`).get()).exists).toBe(false)
    })

    it('removes every rendered PDF and all three asset prefixes', async () => {
        const id = await make_design()
        const version_id = await make_version(id)
        await put_object(`versions/${version_id}/doc.pdf`, 'application/pdf')
        await put_object(`versions/${version_id}/cover.pdf`, 'application/pdf')
        await put_object(`design_assets/${id}/a.png`)
        await put_object(`version_assets/${id}/a.png`)
        await put_object(`design_cache/${id}/a.png`)

        await handle_delete_design(OWNER, id)
        for (const prefix of [`versions/${version_id}/`, `design_assets/${id}/`,
            `version_assets/${id}/`, `design_cache/${id}/`]){
            expect(await list_paths(prefix)).toEqual([])
        }
    })

    it('leaves another design\'s assets alone', async () => {
        const mine = await make_design()
        const other = await make_design()
        await put_object(`design_assets/${other}/keep.png`)
        await handle_delete_design(OWNER, mine)
        expect(await object_exists(`design_assets/${other}/keep.png`)).toBe(true)
    })

    it('refuses a non-owner editor', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        const result = await handle_delete_design(EDITOR, id)
        expect(result.status).toBe(404)
        expect((await admin_db.doc(`designs/${id}`).get()).exists).toBe(true)
    })

    it('refuses a stranger', async () => {
        const id = await make_design()
        expect((await handle_delete_design(STRANGER, id)).status).toBe(404)
        expect((await admin_db.doc(`designs/${id}`).get()).exists).toBe(true)
    })

    it('answers a missing design the same as a forbidden one would be answered', async () => {
        // Missing is success (idempotent); forbidden is a 404 that tells an editor nothing more
        expect((await handle_delete_design(OWNER, new_id())).status).toBe(200)
    })

    it('is idempotent', async () => {
        const id = await make_design()
        await handle_delete_design(OWNER, id)
        expect((await handle_delete_design(OWNER, id)).status).toBe(200)
    })
})


describe('handle_delete_version', () => {

    it('removes the version doc and its PDFs', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        await put_object(`versions/${version_id}/doc.pdf`, 'application/pdf')
        expect((await handle_delete_version(OWNER, version_id)).status).toBe(200)
        expect((await admin_db.doc(`versions/${version_id}`).get()).exists).toBe(false)
        expect(await object_exists(`versions/${version_id}/doc.pdf`)).toBe(false)
    })

    it('leaves the parent design in place', async () => {
        const design_id = await make_design()
        const version_id = await make_version(design_id)
        await handle_delete_version(OWNER, version_id)
        expect((await admin_db.doc(`designs/${design_id}`).get()).exists).toBe(true)
    })

    it('lets the design owner delete a co-editor\'s version', async () => {
        const design_id = await make_design({editor_uids: [OWNER, EDITOR]})
        const version_id = await make_version(design_id, {owner: EDITOR})
        expect((await handle_delete_version(OWNER, version_id)).status).toBe(200)
    })

    it('lets the version\'s own creator delete it', async () => {
        const design_id = await make_design({owner: OWNER, editor_uids: [OWNER, EDITOR]})
        const version_id = await make_version(design_id, {owner: EDITOR})
        expect((await handle_delete_version(EDITOR, version_id)).status).toBe(200)
    })

    it('refuses anyone who is neither', async () => {
        const design_id = await make_design({editor_uids: [OWNER, EDITOR]})
        const version_id = await make_version(design_id)
        expect((await handle_delete_version(EDITOR, version_id)).status).toBe(404)
        expect((await handle_delete_version(STRANGER, version_id)).status).toBe(404)
        expect((await admin_db.doc(`versions/${version_id}`).get()).exists).toBe(true)
    })

    it('is idempotent', async () => {
        expect((await handle_delete_version(OWNER, new_id())).status).toBe(200)
    })

    describe('snapshot reclamation', () => {

        // The only thing that ever frees version_assets/, which is append-only for the design's
        // whole life otherwise

        it('sweeps a snapshot no sibling version still needs', async () => {
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/only_mine.png`)
            const version_id = await make_version(design_id, {blueprint: {content: [
                passage_with_image('p1',
                    upload_image(`version_assets/${design_id}/only_mine.png`))]}})

            await at_later_time(PAST_SWEEP_GRACE_MS,
                () => handle_delete_version(OWNER, version_id))
            expect(await object_exists(`version_assets/${design_id}/only_mine.png`)).toBe(false)
        })

        it('spares a snapshot uploaded moments ago, even with nothing referencing it', async () => {
            // The sweep grace period: an upload lands before the debounced doc write that names
            // it, and deleting inside that gap would destroy a file the doc just does not
            // mention yet
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/just_uploaded.png`)
            const version_id = await make_version(design_id)

            await handle_delete_version(OWNER, version_id)
            expect(await object_exists(`version_assets/${design_id}/just_uploaded.png`))
                .toBe(true)
        })

        it('keeps a snapshot a sibling version still references', async () => {
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/shared.png`)
            const image = upload_image(`version_assets/${design_id}/shared.png`)
            const doomed = await make_version(design_id,
                {blueprint: {content: [passage_with_image('p1', image)]}})
            await make_version(design_id,
                {blueprint: {content: [passage_with_image('p1', image)]}})

            await at_later_time(PAST_SWEEP_GRACE_MS, () => handle_delete_version(OWNER, doomed))
            expect(await object_exists(`version_assets/${design_id}/shared.png`)).toBe(true)
        })

        it('keeps a snapshot a sibling references through its font list', async () => {
            const design_id = await make_design()
            await put_object(`version_assets/${design_id}/font.bin`, 'font/otf')
            const doomed = await make_version(design_id)
            await make_version(design_id, {custom_fonts: [{family: 'F', style: 'normal',
                files: [`version_assets/${design_id}/font.bin`]}]})

            await at_later_time(PAST_SWEEP_GRACE_MS, () => handle_delete_version(OWNER, doomed))
            expect(await object_exists(`version_assets/${design_id}/font.bin`)).toBe(true)
        })

        it('never touches the live design prefix', async () => {
            const design_id = await make_design()
            await put_object(`design_assets/${design_id}/live.png`)
            const version_id = await make_version(design_id)
            await at_later_time(PAST_SWEEP_GRACE_MS,
                () => handle_delete_version(OWNER, version_id))
            expect(await object_exists(`design_assets/${design_id}/live.png`)).toBe(true)
        })
    })

    describe('latest_version summary', () => {

        // Left stale, the /designs row keeps reporting a page count for something that is gone,
        // and design_needs_version() keeps reading false

        it('clears the summary when the last version goes', async () => {
            const design_id = await make_design(
                {latest_version: {status: 'available', pages: 120, save_token: 'tok_a'}})
            const version_id = await make_version(design_id, {save_token: 'tok_a'})
            await handle_delete_version(OWNER, version_id)
            expect((await admin_db.doc(`designs/${design_id}`).get()).data()!['latest_version'])
                .toBe(null)
        })

        it('repoints the summary at the newest survivor', async () => {
            const design_id = await make_design(
                {latest_version: {status: 'available', pages: 120, save_token: 'tok_new'}})
            await make_version(design_id, {save_token: 'tok_old', pages: 80,
                created: new Date(Date.now() - 10_000)})
            const newest = await make_version(design_id, {save_token: 'tok_new', pages: 120,
                created: new Date()})

            await handle_delete_version(OWNER, newest)
            const summary = (await admin_db.doc(`designs/${design_id}`).get())
                .data()!['latest_version'] as {save_token:string, pages:number}
            expect(summary.save_token).toBe('tok_old')
            expect(summary.pages).toBe(80)
        })

        it('leaves the summary alone when it described a different version', async () => {
            const design_id = await make_design(
                {latest_version: {status: 'available', pages: 120, save_token: 'tok_new'}})
            const older = await make_version(design_id, {save_token: 'tok_old'})
            await make_version(design_id, {save_token: 'tok_new'})

            await handle_delete_version(OWNER, older)
            const summary = (await admin_db.doc(`designs/${design_id}`).get())
                .data()!['latest_version'] as {save_token:string}
            expect(summary.save_token).toBe('tok_new')
        })
    })
})


describe('handle_duplicate_design', () => {

    it('creates a new design owned by the caller', async () => {
        const id = await make_design({name: 'Original'})
        const result = await handle_duplicate_design(OWNER, id)
        expect(result.status).toBe(200)
        const copy_id = (result.body as {design_id:string}).design_id
        expect(copy_id).not.toBe(id)
        const copy = (await admin_db.doc(`designs/${copy_id}`).get()).data()
        expect(copy!['owner']).toBe(OWNER)
        expect(copy!['editor_uids']).toEqual([OWNER])
        expect(copy!['name']).toBe('Original')
    })

    it('lets an invited editor take a copy of their own', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        const result = await handle_duplicate_design(EDITOR, id)
        expect(result.status).toBe(200)
        const copy_id = (result.body as {design_id:string}).design_id
        const copy = (await admin_db.doc(`designs/${copy_id}`).get()).data()
        expect(copy!['owner']).toBe(EDITOR)
        expect(copy!['editor_uids']).toEqual([EDITOR])
    })

    it('does not carry the source\'s co-editors across', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR],
            editors: {[EDITOR]: {joined: new Date()}}})
        const copy_id = (await handle_duplicate_design(OWNER, id)).body as {design_id:string}
        const copy = (await admin_db.doc(`designs/${copy_id.design_id}`).get()).data()
        expect(copy!['editor_uids']).toEqual([OWNER])
        expect(copy!['editors']).toEqual({})
    })

    it('gives the copy a fresh share token', async () => {
        const id = await make_design({share_token: 'original_token'})
        const copy_id = (await handle_duplicate_design(OWNER, id)).body as {design_id:string}
        const copy = (await admin_db.doc(`designs/${copy_id.design_id}`).get()).data()
        expect(copy!['share_token']).toBeTruthy()
        expect(copy!['share_token']).not.toBe('original_token')
    })

    it('starts the copy with no render history', async () => {
        const id = await make_design()
        await make_version(id)
        const copy_id = (await handle_duplicate_design(OWNER, id)).body as {design_id:string}
        const copy = (await admin_db.doc(`designs/${copy_id.design_id}`).get()).data()
        expect(copy!['latest_version']).toBe(null)
        const versions = await admin_db.collection('versions')
            .where('design_id', '==', copy_id.design_id).get()
        expect(versions.empty).toBe(true)
    })

    it('refuses a caller who cannot edit the source', async () => {
        const id = await make_design()
        expect((await handle_duplicate_design(STRANGER, id)).status).toBe(404)
    })

    it('refuses a design that does not exist', async () => {
        expect((await handle_duplicate_design(OWNER, new_id())).status).toBe(404)
    })

    describe('assets', () => {

        it('copies the live assets into the new design\'s own prefix', async () => {
            const id = await make_design(design_id => ({
                content_items: {p1: passage_with_image('p1',
                    upload_image(`design_assets/${design_id}/pic.png`))},
                content_order: ['p1'],
            }))
            await put_object(`design_assets/${id}/pic.png`)

            const copy_id = ((await handle_duplicate_design(OWNER, id)).body as
                {design_id:string}).design_id
            expect(await object_exists(`design_assets/${copy_id}/pic.png`)).toBe(true)
            const copy = (await admin_db.doc(`designs/${copy_id}`).get()).data()
            const path = (copy!['content_items'] as Record<string, {image:{path:string}}>)['p1']!
                .image.path
            expect(path).toBe(`design_assets/${copy_id}/pic.png`)
        })

        it('leaves the source\'s assets in place', async () => {
            const id = await make_design()
            await put_object(`design_assets/${id}/pic.png`)
            await handle_duplicate_design(OWNER, id)
            expect(await object_exists(`design_assets/${id}/pic.png`)).toBe(true)
        })

        it('copies no version snapshots — the copy has no versions to render', async () => {
            const id = await make_design()
            await put_object(`version_assets/${id}/frozen.png`)
            const copy_id = ((await handle_duplicate_design(OWNER, id)).body as
                {design_id:string}).design_id
            expect(await list_paths(`version_assets/${copy_id}/`)).toEqual([])
        })

        it('re-ids the fonts and points them at the copy\'s prefix', async () => {
            const id = await make_design(design_id => ({fonts: {font_a: {family: 'My Font',
                style: 'normal', files: [`design_assets/${design_id}/font.bin`]}}}))
            await put_object(`design_assets/${id}/font.bin`, 'font/otf')

            const copy_id = ((await handle_duplicate_design(OWNER, id)).body as
                {design_id:string}).design_id
            const copy = (await admin_db.doc(`designs/${copy_id}`).get()).data()
            const fonts = copy!['fonts'] as Record<string, {family:string, files:string[]}>
            expect(Object.keys(fonts)).toHaveLength(1)
            expect(Object.keys(fonts)[0]).not.toBe('font_a')
            expect(Object.values(fonts)[0]!.family).toBe('My Font')
            expect(Object.values(fonts)[0]!.files)
                .toEqual([`design_assets/${copy_id}/font.bin`])
            expect(await object_exists(`design_assets/${copy_id}/font.bin`)).toBe(true)
        })
    })

    it('keeps the copy simple when the source was made by the wizard', async () => {
        const id = await make_design({simple_mode: true, wizard_draft: {step: 2}})
        const copy_id = ((await handle_duplicate_design(OWNER, id)).body as
            {design_id:string}).design_id
        const copy = (await admin_db.doc(`designs/${copy_id}`).get()).data()
        expect(copy!['simple_mode']).toBe(true)
        expect(copy!['wizard_draft']).toEqual({step: 2})
    })
})
