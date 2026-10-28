
// Accepting a server compile. The route only checks a version and hands it to the compile
// function, answering before any compile runs, so every way it can refuse has to be decided here:
// the client never hears from the compile itself, only from the version doc it updates.
//
// No test here reaches an accepted compile — from source that runs in-process (see
// dispatch_job), which would be a real Typst render rather than a check of the route.

import {describe, it, expect, beforeEach} from 'vitest'

import {check_assets, handle_compile, run_compile} from '../../server/src/compile.ts'
import {claim_compile_lock, QUOTA_COMPILE, DAILY_COMPILE_LIMIT} from '../../server/src/quota.ts'
import {admin_db, reset_firestore, design_doc, version_doc, new_id, passage_with_image, OWNER,
    STRANGER} from '../helpers/server.ts'

import type {CompileJob} from '../../server/src/compile.ts'
import type {Blueprint} from 'paper-bible-typst-node'


beforeEach(async () => {
    await reset_firestore()
})


async function make_pending(overrides:Record<string, unknown> = {}):Promise<string>{
    // A design with one pending version of it, the state a version is in when handed over
    const design_id = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc())
    const id = new_id()
    await admin_db.doc(`versions/${id}`).set(
        version_doc(design_id, {status: 'pending', pdf_path: `versions/${id}/doc.pdf`,
            ...overrides}))
    return id
}


// A compile request from a given user for a given version
function job(version_id:string, uid = OWNER):CompileJob{
    return {uid, version_id, client_ip: null, user_agent: null}
}


describe('handle_compile', () => {

    it('refuses an unknown version', async () => {
        const result = await handle_compile(job('no_such_version'))
        expect(result).toEqual({status: 404, body: {error: 'unknown_version'}})
    })

    it('refuses someone else\'s version', async () => {
        const id = await make_pending()
        const result = await handle_compile(job(id, STRANGER))
        expect(result).toEqual({status: 403, body: {error: 'not_owner'}})
    })

    it('refuses a version that is no longer pending', async () => {
        const id = await make_pending({status: 'available'})
        const result = await handle_compile(job(id))
        expect(result).toEqual({status: 409, body: {error: 'not_pending'}})
    })

    it('refuses a font snapshot outside the design\'s own prefix', async () => {
        const id = await make_pending({custom_fonts: [{family: 'X', style: 'serif',
            files: ['version_assets/another_design/abc.bin']}]})
        const result = await handle_compile(job(id))
        expect(result).toEqual({status: 400, body: {error: 'bad_font_path'}})
    })

    it('makes the user wait while another of their compiles runs', async () => {
        const id = await make_pending()
        await claim_compile_lock(OWNER, 'some_other_version')
        const result = await handle_compile(job(id))
        expect(result).toEqual({status: 429, body: {error: 'compile_in_progress'}})
    })

    it('treats a compile of this same version already running as not pending', async () => {
        // Another tab, or a retry racing the original — its outcome arrives via the doc either way
        const id = await make_pending()
        await claim_compile_lock(OWNER, id)
        const result = await handle_compile(job(id))
        expect(result).toEqual({status: 409, body: {error: 'not_pending'}})
    })

    it('takes a cover-only compile only for a published version handed over for its cover',
            async () => {
        // Still compiling its interior, or a cover that's already settled: nothing to hand over
        for (const fields of [{status: 'pending', cover_status: null},
                {status: 'available', cover_status: 'available'},
                {status: 'available', cover_status: 'failed'}]){
            const id = await make_pending(fields)
            expect(await handle_compile({...job(id), cover_only: true})).toEqual(
                {status: 409, body: {error: 'not_pending'}})
        }
        // And never a full compile of one that's already published
        const id = await make_pending({status: 'available', cover_status: 'pending'})
        expect(await handle_compile(job(id))).toEqual(
            {status: 409, body: {error: 'not_pending'}})
    })

    it('refuses a cover-only compile of a version without a cover', async () => {
        const id = await make_pending({status: 'available', cover_status: 'pending'})
        expect(await handle_compile({...job(id), cover_only: true})).toEqual(
            {status: 400, body: {error: 'no_cover'}})
    })

    it('refuses once over the daily quota, without keeping the lock', async () => {
        const id = await make_pending()
        await admin_db.doc(`${QUOTA_COMPILE}/${OWNER}`).set({
            day: new Date().toISOString().slice(0, 10), count: DAILY_COMPILE_LIMIT})
        const result = await handle_compile(job(id))
        expect(result).toEqual({status: 429, body: {error: 'quota_exceeded'}})
        expect(await claim_compile_lock(OWNER, 'another_version')).toBe('claimed')
    })
})


describe('run_compile', () => {

    it('skips a version a concurrent compile already finished, releasing the lock', async () => {
        const id = await make_pending({status: 'available'})
        await claim_compile_lock(OWNER, id)
        await run_compile(job(id))
        expect((await admin_db.doc(`versions/${id}`).get()).data()!['status']).toBe('available')
        expect(await claim_compile_lock(OWNER, 'another_version')).toBe('claimed')
    })
})


describe('check_assets', () => {

    // A design's own snapshot prefix, and a blueprint whose cover names some background
    const PREFIX = 'version_assets/design_a/'
    const with_bg = (bg_image:unknown) => ({content: [], cover: {bg_image}}) as unknown as Blueprint

    it('accepts a background under the design\'s prefix, or a plainly named builtin', () => {
        expect(check_assets(with_bg(null), [], PREFIX)).toBe(null)
        expect(check_assets(with_bg({kind: 'custom', path: `${PREFIX}abc.jpg`}), [], PREFIX))
            .toBe(null)
        expect(check_assets(with_bg({kind: 'builtin', id: 'hills.jpg'}), [], PREFIX)).toBe(null)
    })

    it('refuses a custom background anywhere but the design\'s own prefix', () => {
        for (const path of ['version_assets/design_b/abc.jpg', 'errors/x/y.json', 42, undefined]){
            expect(check_assets(with_bg({kind: 'custom', path}), [], PREFIX))
                .toBe('bad_cover_path')
        }
    })

    it('refuses a builtin id that could become anything but a plain filename', () => {
        // Traversal, a subdirectory of backgrounds/, not an image, not a string
        for (const id of ['../../etc/passwd.jpg', 'previews_800/hills.jpg', 'hills.sh', 7]){
            expect(check_assets(with_bg({kind: 'builtin', id}), [], PREFIX))
                .toBe('bad_cover_image')
        }
    })

    it('refuses a background of no known shape', () => {
        for (const bg_image of ['hills.jpg', {kind: 'url', url: 'https://example.com/x.jpg'}, {}]){
            expect(check_assets(with_bg(bg_image), [], PREFIX)).toBe('bad_cover_image')
        }
    })

    it('refuses a passage image no server should fetch', () => {
        const blueprint = {cover: null, content: [passage_with_image('p1',
            {source: 'url', url: 'file:///etc/passwd', path: null, hash: null})]}
        expect(check_assets(blueprint as unknown as Blueprint, [], PREFIX)).toBe('bad_image_url')
    })
})
