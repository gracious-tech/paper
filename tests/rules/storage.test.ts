
// Security-rule tests for firebase_storage.rules.
//
// Two properties carry most of the weight here. Nothing grants delete, which is what stops one
// editor destroying the inputs another's published version renders from; and version_assets/ is
// append-only by rule, so editing a design can never change the bytes an already-published
// version renders. Uploads are also type-pinned, not merely size-capped, so these prefixes can't
// become general file hosting on a Google domain.

import {assertSucceeds, assertFails} from '@firebase/rules-unit-testing'
import {ref, uploadBytes, getBytes, deleteObject, listAll, getMetadata, updateMetadata}
    from 'firebase/storage'
import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest'

import {make_test_env, storage_for, seed, clear_storage, design_data, version_data,
    OWNER, EDITOR, STRANGER} from '../helpers/emulator.js'

import type {RulesTestEnvironment} from '@firebase/rules-unit-testing'


let env:RulesTestEnvironment


// Small stand-in payloads — the rules never look at the bytes, only the declared content type
const BYTES = new Uint8Array([1, 2, 3, 4])


// Upload as the given user, declaring a content type (the rules allowlist it explicitly)
function upload(uid:string|null, path:string, content_type:string,
        bytes:Uint8Array = BYTES):Promise<unknown>{
    return uploadBytes(ref(storage_for(env, uid), path), bytes as BlobPart as Uint8Array,
        {contentType: content_type})
}


// Put an object in place with the rules bypassed, so a test can start from state a client could
// not have created (someone else's upload, an already-frozen snapshot)
async function place(path:string, content_type:string):Promise<void>{
    await env.withSecurityRulesDisabled(async context => {
        await uploadBytes(ref(context.storage(), path), BYTES as BlobPart as Uint8Array,
            {contentType: content_type})
    })
}


beforeAll(async () => {
    env = await make_test_env()
})

afterAll(async () => {
    await env.cleanup()
})

beforeEach(async () => {
    await env.clearFirestore()
    await clear_storage(env)
    // Every asset prefix authorises against the design doc's editor_uids, so the doc has to exist
    await seed(env, [
        {path: 'designs/design_main', data: design_data({editor_uids: [OWNER, EDITOR]})},
        {path: 'designs/design_other', data: design_data(
            {owner: STRANGER, editor_uids: [STRANGER]})},
    ])
})


describe('design_assets', () => {

    const path = 'design_assets/design_main/hash1.png'

    it('lets the owner upload', async () => {
        await assertSucceeds(upload(OWNER, path, 'image/png'))
    })

    it('lets an invited editor upload', async () => {
        await assertSucceeds(upload(EDITOR, path, 'image/png'))
    })

    it('denies a stranger', async () => {
        await assertFails(upload(STRANGER, path, 'image/png'))
    })

    it('denies a signed-out caller', async () => {
        await assertFails(upload(null, path, 'image/png'))
    })

    it('denies an editor of a different design', async () => {
        // Authorisation is per design prefix, not per account
        await assertFails(upload(STRANGER, 'design_assets/design_main/x.png', 'image/png'))
        await assertSucceeds(upload(STRANGER, 'design_assets/design_other/x.png', 'image/png'))
    })

    it('denies uploading under a design id with no doc', async () => {
        await assertFails(upload(OWNER, 'design_assets/design_absent/x.png', 'image/png'))
    })

    it('allows overwriting — a design asset is live, mutable state', async () => {
        await assertSucceeds(upload(OWNER, path, 'image/png'))
        await assertSucceeds(upload(OWNER, path, 'image/png'))
    })

    describe('type pinning', () => {

        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'font/ttf', 'font/otf']

        for (const type of allowed){
            it(`allows ${type}`, async () => {
                await assertSucceeds(upload(OWNER, `design_assets/design_main/h.bin`, type))
            })
        }

        // Without the allowlist any file under the size cap could be parked here and handed
        // back out publicly from a Google domain, and the compile service's image pipeline
        // would be fed arbitrary bytes
        const denied = ['application/pdf', 'text/html', 'image/svg+xml', 'application/zip',
            'text/plain', 'application/javascript', 'video/mp4', 'font/woff2']

        for (const type of denied){
            it(`denies ${type}`, async () => {
                await assertFails(upload(OWNER, `design_assets/design_main/h.bin`, type))
            })
        }

        it('denies an upload with no declared content type', async () => {
            await assertFails(uploadBytes(
                ref(storage_for(env, OWNER), path), BYTES as BlobPart as Uint8Array))
        })
    })

    it('denies an upload at or over the 20MB cap', async () => {
        const oversize = new Uint8Array(20 * 1024 * 1024)
        await assertFails(upload(OWNER, path, 'image/png', oversize))
    })

    it('is publicly readable by exact path', async () => {
        await place(path, 'image/png')
        await assertSucceeds(getBytes(ref(storage_for(env, STRANGER), path)))
        await assertSucceeds(getBytes(ref(storage_for(env, null), path)))
    })

    it('is not listable, so the path stays the whole capability', async () => {
        await place(path, 'image/png')
        await assertFails(listAll(ref(storage_for(env, OWNER), 'design_assets/design_main')))
        await assertFails(listAll(ref(storage_for(env, OWNER), 'design_assets')))
    })

    it('grants no delete to anyone, owner included', async () => {
        await place(path, 'image/png')
        await assertFails(deleteObject(ref(storage_for(env, OWNER), path)))
        await assertFails(deleteObject(ref(storage_for(env, EDITOR), path)))
        await assertFails(deleteObject(ref(storage_for(env, STRANGER), path)))
    })
})


describe('version_assets', () => {

    const path = 'version_assets/design_main/hash1.png'

    it('lets an editor freeze a snapshot', async () => {
        await assertSucceeds(upload(EDITOR, path, 'image/png'))
    })

    it('denies a stranger', async () => {
        await assertFails(upload(STRANGER, path, 'image/png'))
    })

    // Append-only as a rule, not a convention — this is what guarantees a design edit can't
    // rewrite the bytes a published version renders from
    it('denies overwriting an existing snapshot, even by the owner', async () => {
        await assertSucceeds(upload(OWNER, path, 'image/png'))
        await assertFails(upload(OWNER, path, 'image/png'))
    })

    it('denies overwriting a co-editor\'s snapshot', async () => {
        await assertSucceeds(upload(EDITOR, path, 'image/png'))
        await assertFails(upload(OWNER, path, 'image/png'))
    })

    it('denies replacing a snapshot with a different type', async () => {
        await assertSucceeds(upload(OWNER, path, 'image/png'))
        await assertFails(upload(OWNER, path, 'image/jpeg'))
    })

    it('denies updating an existing snapshot\'s metadata', async () => {
        await place(path, 'image/png')
        await assertFails(updateMetadata(
            ref(storage_for(env, OWNER), path), {contentType: 'text/html'}))
    })

    it('pins the type like design_assets does', async () => {
        await assertFails(upload(OWNER, 'version_assets/design_main/a.bin', 'application/pdf'))
        await assertSucceeds(upload(OWNER, 'version_assets/design_main/b.bin', 'font/otf'))
    })

    it('is publicly readable and never listable', async () => {
        await place(path, 'image/png')
        await assertSucceeds(getBytes(ref(storage_for(env, null), path)))
        await assertFails(listAll(ref(storage_for(env, OWNER), 'version_assets/design_main')))
    })

    it('grants no delete', async () => {
        await place(path, 'image/png')
        await assertFails(deleteObject(ref(storage_for(env, OWNER), path)))
    })
})


describe('design_cache', () => {

    const path = 'design_cache/design_main/variant1.png'

    it('lets an editor write a derived variant', async () => {
        await assertSucceeds(upload(EDITOR, path, 'image/png'))
    })

    it('allows overwriting — these are regenerable', async () => {
        await assertSucceeds(upload(OWNER, path, 'image/png'))
        await assertSucceeds(upload(OWNER, path, 'image/png'))
    })

    it('denies a stranger', async () => {
        await assertFails(upload(STRANGER, path, 'image/png'))
    })

    it('pins the type tighter than the other prefixes — PNG only', async () => {
        // Only ever holds the painted/torn variants the client bakes
        await assertFails(upload(OWNER, path, 'image/jpeg'))
        await assertFails(upload(OWNER, path, 'image/webp'))
        await assertFails(upload(OWNER, path, 'font/otf'))
        await assertFails(upload(OWNER, path, 'text/html'))
    })

    it('grants no delete', async () => {
        await place(path, 'image/png')
        await assertFails(deleteObject(ref(storage_for(env, OWNER), path)))
    })
})


describe('version PDFs', () => {

    const doc_path = 'versions/v_main/doc.pdf'
    const cover_path = 'versions/v_main/cover.pdf'

    beforeEach(async () => {
        await seed(env, [{path: 'versions/v_main', data: version_data('v_main')}])
    })

    it('lets the version\'s owner upload their compiled PDF', async () => {
        await assertSucceeds(upload(OWNER, doc_path, 'application/pdf'))
    })

    it('lets the owner upload the cover too', async () => {
        await assertSucceeds(upload(OWNER, cover_path, 'application/pdf'))
    })

    it('denies a co-editor of the parent design', async () => {
        await assertFails(upload(EDITOR, doc_path, 'application/pdf'))
    })

    it('denies a stranger who knows the version id', async () => {
        // Public read by id must not imply public write by id
        await assertFails(upload(STRANGER, doc_path, 'application/pdf'))
        await assertFails(upload(null, doc_path, 'application/pdf'))
    })

    it('denies uploading against a version id with no doc', async () => {
        await assertFails(upload(OWNER, 'versions/v_absent/doc.pdf', 'application/pdf'))
    })

    // Create-once: regeneration only works because the lifecycle rule deleted the object first
    it('denies overwriting an existing PDF', async () => {
        await assertSucceeds(upload(OWNER, doc_path, 'application/pdf'))
        await assertFails(upload(OWNER, doc_path, 'application/pdf'))
    })

    it('allows re-creating one the lifecycle rule has swept', async () => {
        await assertSucceeds(upload(OWNER, doc_path, 'application/pdf'))
        await env.withSecurityRulesDisabled(async context => {
            await deleteObject(ref(context.storage(), doc_path))
        })
        await assertSucceeds(upload(OWNER, doc_path, 'application/pdf'))
    })

    it('pins the content type to PDF', async () => {
        await assertFails(upload(OWNER, doc_path, 'text/html'))
        await assertFails(upload(OWNER, doc_path, 'image/png'))
        await assertFails(upload(OWNER, doc_path, 'application/octet-stream'))
    })

    it('is publicly readable by id alone — that is what sharing a version is', async () => {
        await place(doc_path, 'application/pdf')
        await assertSucceeds(getBytes(ref(storage_for(env, STRANGER), doc_path)))
        await assertSucceeds(getBytes(ref(storage_for(env, null), doc_path)))
        await assertSucceeds(getMetadata(ref(storage_for(env, null), doc_path)))
    })

    it('is not listable', async () => {
        await place(doc_path, 'application/pdf')
        await assertFails(listAll(ref(storage_for(env, OWNER), 'versions/v_main')))
        await assertFails(listAll(ref(storage_for(env, OWNER), 'versions')))
    })

    it('grants no delete, so a published PDF outlives its creator\'s whims', async () => {
        await place(doc_path, 'application/pdf')
        await assertFails(deleteObject(ref(storage_for(env, OWNER), doc_path)))
        await assertFails(deleteObject(ref(storage_for(env, STRANGER), doc_path)))
    })

    it('denies any other filename inside a version prefix', async () => {
        // Only doc.pdf and cover.pdf are matched; nothing else has a rule at all
        await assertFails(upload(OWNER, 'versions/v_main/notes.pdf', 'application/pdf'))
        await assertFails(upload(OWNER, 'versions/v_main/sub/doc.pdf', 'application/pdf'))
    })
})


describe('undeclared paths', () => {

    it('denies writing anywhere no rule covers', async () => {
        await assertFails(upload(OWNER, 'arbitrary/file.png', 'image/png'))
        await assertFails(upload(OWNER, 'errors/fingerprint/report.json', 'application/json'))
        await assertFails(upload(OWNER, 'design_assets/design_main/sub/dir.png', 'image/png'))
        await assertFails(upload(OWNER, 'root_level.png', 'image/png'))
    })

    it('denies reading a path no rule covers', async () => {
        // Error reports land in the bucket but are never client-readable
        await place('errors/fingerprint/report.json', 'application/json')
        await assertFails(getBytes(ref(storage_for(env, OWNER), 'errors/fingerprint/report.json')))
    })

    it('denies listing the bucket root', async () => {
        await assertFails(listAll(ref(storage_for(env, OWNER), '')))
    })
})


describe('prefix isolation', () => {

    it('keeps the same basename separate across the three prefixes', async () => {
        // Content-addressed basenames are identical across prefixes by design — the prefix is
        // what carries the lifecycle, so each must be authorised on its own terms
        await assertSucceeds(upload(OWNER, 'design_assets/design_main/h.png', 'image/png'))
        await assertSucceeds(upload(OWNER, 'version_assets/design_main/h.png', 'image/png'))
        await assertSucceeds(upload(OWNER, 'design_cache/design_main/h.png', 'image/png'))
        // The design_assets copy is still overwritable, the version_assets one is not
        await assertSucceeds(upload(OWNER, 'design_assets/design_main/h.png', 'image/png'))
        await assertFails(upload(OWNER, 'version_assets/design_main/h.png', 'image/png'))
    })

    it('does not let a design id resolve another design\'s editor set', async () => {
        for (const prefix of ['design_assets', 'version_assets', 'design_cache']){
            await assertFails(upload(EDITOR, `${prefix}/design_other/h.png`, 'image/png'))
        }
    })
})
