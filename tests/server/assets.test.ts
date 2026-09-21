
// Asset collection, re-pathing, sweeping and the two routes built on them.
//
// The recurring theme is that only the *basename* of a client-written path is ever trusted: a
// blueprint comes off a doc a co-editor wrote, and the security rules only require it to be a map.
// Everything below either takes a basename and rebuilds the path from a prefix the server chose,
// or refuses to look outside a prefix it already owns.

import {describe, it, expect, beforeEach} from 'vitest'

import {collect_asset_basenames, collect_version_basenames, collect_image_urls, repath_assets,
    copy_basenames, sweep_prefix, delete_prefix, design_prefixes, join_design_blueprint,
    storage_public_url, handle_reconcile_assets, handle_touch_assets}
    from '../../server/src/assets.ts'
import {admin_db, admin_bucket, reset_firestore, reset_storage, put_object, object_exists,
    list_paths, design_doc, version_doc, upload_image, passage_with_image, new_id,
    at_later_time, PAST_SWEEP_GRACE_MS, OWNER, EDITOR, STRANGER} from '../helpers/server.ts'

import type {Blueprint} from 'paper-bible-typst'


beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
})


async function make_design(
        overrides:Record<string, unknown>|((id:string) => Record<string, unknown>) = {},
):Promise<string>{
    const id = new_id()
    await admin_db.doc(`designs/${id}`).set(
        design_doc(typeof overrides === 'function' ? overrides(id) : overrides))
    return id
}


// A blueprint carrying whatever content is given
function blueprint(content:unknown[], extra:Record<string, unknown> = {}):Blueprint {
    return {content, cover: null, ...extra} as unknown as Blueprint
}


// A picture story whose slides carry images
function story_with_images(id:string, images:unknown[]):Record<string, unknown>{
    return {type: 'picture_story', id, title: null, title_subtitle: '', title_icon: null,
        slides: images.map((image, i) => ({id: `s${i}`, image, mode: 'passage', book: 'gen',
            start_chapter: null, start_verse: null, end_chapter: null, end_verse: null,
            doc: {type: 'doc', content: []}}))}
}


describe('collect_version_basenames', () => {

    it('finds a passage image', () => {
        const names = collect_version_basenames({blueprint: blueprint([
            passage_with_image('p1', upload_image('version_assets/d1/pic.png'))])})
        expect([...names]).toEqual(['pic.png'])
    })

    it('finds a picture story\'s slide images', () => {
        const names = collect_version_basenames({blueprint: blueprint([
            story_with_images('s1', [upload_image('version_assets/d1/a.png'),
                upload_image('version_assets/d1/b.png')])])})
        expect([...names].sort()).toEqual(['a.png', 'b.png'])
    })

    it('finds an image\'s unmasked original as well as the masked copy', () => {
        // The render needs the masked one, turning the version back into a design needs the other
        const names = collect_version_basenames({blueprint: blueprint([
            passage_with_image('p1', {...upload_image('version_assets/d1/masked.png'),
                original: upload_image('version_assets/d1/raw.png')})])})
        expect([...names].sort()).toEqual(['masked.png', 'raw.png'])
    })

    it('finds a custom cover background', () => {
        const names = collect_version_basenames({blueprint: blueprint([], {cover: {form: {},
            bg_image: {kind: 'custom', path: 'version_assets/d1/bg.jpg', hash: 'h'},
            font_families: [], title_custom: false}})})
        expect([...names]).toEqual(['bg.jpg'])
    })

    it('ignores a builtin cover background — it is a reference, not an upload', () => {
        const names = collect_version_basenames({blueprint: blueprint([], {cover: {form: {},
            bg_image: {kind: 'builtin', id: 'hills.jpg'}, font_families: [],
            title_custom: false}})})
        expect([...names]).toEqual([])
    })

    it('ignores a url-sourced image', () => {
        const names = collect_version_basenames({blueprint: blueprint([
            passage_with_image('p1', {source: 'url', url: 'https://example.com/a.png',
                path: null, hash: null, original: null})])})
        expect([...names]).toEqual([])
    })

    it('finds font files', () => {
        const names = collect_version_basenames({blueprint: blueprint([]),
            custom_fonts: [{family: 'F', style: 'normal',
                files: ['version_assets/d1/a.bin', 'version_assets/d1/b.bin']}]})
        expect([...names].sort()).toEqual(['a.bin', 'b.bin'])
    })

    it('reduces a hostile path to its basename', () => {
        const names = collect_version_basenames({blueprint: blueprint([
            passage_with_image('p1',
                upload_image('../../versions/somebody/doc.pdf'))])})
        expect([...names]).toEqual(['doc.pdf'])
    })

    it('survives a blueprint that is not shaped like one', () => {
        // The rules only require a version's blueprint to be a map
        expect([...collect_version_basenames({})]).toEqual([])
        expect([...collect_version_basenames({blueprint: {content: 'nope'}})]).toEqual([])
        expect([...collect_version_basenames({blueprint: blueprint([null, 42, {}])})])
            .toEqual([])
        expect([...collect_version_basenames(
            {blueprint: blueprint([story_with_images('s1', [])]), custom_fonts: 'nope'})])
            .toEqual([])
    })

    it('deduplicates a basename used twice', () => {
        const image = upload_image('version_assets/d1/same.png')
        const names = collect_version_basenames({blueprint: blueprint([
            passage_with_image('p1', image), passage_with_image('p2', image)])})
        expect([...names]).toEqual(['same.png'])
    })
})


describe('collect_asset_basenames', () => {

    it('reads a design\'s split content fields and font map', () => {
        const names = collect_asset_basenames(design_doc({
            content_items: {p1: passage_with_image('p1',
                upload_image('design_assets/d1/pic.png'))},
            content_order: ['p1'],
            fonts: {f1: {family: 'F', style: 'normal', files: ['design_assets/d1/font.bin']}},
        }))
        expect([...names].sort()).toEqual(['font.bin', 'pic.png'])
    })

    it('ignores an item the order array does not list', () => {
        // join_blueprint_doc rebuilds content from content_order, so an orphaned item is not
        // part of the design and its asset is genuinely unreferenced
        const names = collect_asset_basenames(design_doc({
            content_items: {p1: passage_with_image('p1',
                upload_image('design_assets/d1/orphan.png'))},
            content_order: [],
        }))
        expect([...names]).toEqual([])
    })

    it('survives a design doc missing every optional field', () => {
        expect([...collect_asset_basenames({})]).toEqual([])
    })
})


describe('collect_image_urls', () => {

    it('lists every url a compile would fetch', () => {
        const urls = collect_image_urls(blueprint([
            passage_with_image('p1', {source: 'url', url: 'https://example.com/a.png',
                path: null, hash: null, original: null}),
            story_with_images('s1', [{source: 'url', url: 'https://example.com/b.png',
                path: null, hash: null, original: null}]),
        ]))
        expect(urls.sort()).toEqual(['https://example.com/a.png', 'https://example.com/b.png'])
    })

    it('skips images with no url', () => {
        expect(collect_image_urls(blueprint([
            passage_with_image('p1', upload_image('design_assets/d1/a.png'))]))).toEqual([])
    })
})


describe('repath_assets', () => {

    it('moves every reference onto the given prefix, keeping basenames', () => {
        const moved = repath_assets(blueprint([
            passage_with_image('p1', upload_image('version_assets/source/pic.png'))],
        {cover: {form: {}, bg_image: {kind: 'custom', path: 'version_assets/source/bg.jpg',
            hash: 'h'}, font_families: [], title_custom: false}}), 'design_assets/target/')
        const content = moved.content as unknown as {image:{path:string}}[]
        expect(content[0]!.image.path).toBe('design_assets/target/pic.png')
        expect(moved.cover!.bg_image).toMatchObject({path: 'design_assets/target/bg.jpg'})
    })

    it('rewrites the public url alongside the path', () => {
        const moved = repath_assets(blueprint([
            passage_with_image('p1', {...upload_image('version_assets/source/pic.png'),
                url: 'https://example.com/stale'})]), 'design_assets/target/')
        const content = moved.content as unknown as {image:{url:string}}[]
        expect(content[0]!.image.url)
            .toBe(storage_public_url('design_assets/target/pic.png'))
    })

    it('confines a hostile path to the target prefix', () => {
        const moved = repath_assets(blueprint([
            passage_with_image('p1', upload_image('../../versions/other/doc.pdf'))]),
        'design_assets/target/')
        const content = moved.content as unknown as {image:{path:string}}[]
        expect(content[0]!.image.path).toBe('design_assets/target/doc.pdf')
    })

    it('leaves url-sourced images alone', () => {
        const moved = repath_assets(blueprint([
            passage_with_image('p1', {source: 'url', url: 'https://example.com/a.png',
                path: null, hash: null, original: null})]), 'design_assets/target/')
        const content = moved.content as unknown as {image:{url:string, path:string|null}}[]
        expect(content[0]!.image.url).toBe('https://example.com/a.png')
        expect(content[0]!.image.path).toBe(null)
    })

    it('leaves a builtin cover background alone', () => {
        const moved = repath_assets(blueprint([], {cover: {form: {},
            bg_image: {kind: 'builtin', id: 'hills.jpg'}, font_families: [],
            title_custom: false}}), 'design_assets/target/')
        expect(moved.cover!.bg_image).toEqual({kind: 'builtin', id: 'hills.jpg'})
    })

    it('does not mutate the blueprint it was given', () => {
        const original = blueprint([
            passage_with_image('p1', upload_image('version_assets/source/pic.png'))])
        repath_assets(original, 'design_assets/target/')
        const content = original.content as unknown as {image:{path:string}}[]
        expect(content[0]!.image.path).toBe('version_assets/source/pic.png')
    })
})


describe('join_design_blueprint', () => {

    it('rebuilds content in content_order\'s order', () => {
        const joined = join_design_blueprint(design_doc({
            content_items: {a: passage_with_image('a', null), b: passage_with_image('b', null)},
            content_order: ['b', 'a'],
        }))
        expect(joined.content.map(item => item.id)).toEqual(['b', 'a'])
    })

    it('tolerates a doc with no blueprint fields at all', () => {
        expect(join_design_blueprint({}).content).toEqual([])
    })
})


describe('copy_basenames', () => {

    it('copies each named object between prefixes', async () => {
        await put_object('version_assets/src/a.png')
        await put_object('version_assets/src/b.png')
        await copy_basenames('version_assets/src/', 'design_assets/dst/', ['a.png', 'b.png'])
        expect(await list_paths('design_assets/dst/'))
            .toEqual(['design_assets/dst/a.png', 'design_assets/dst/b.png'])
    })

    it('leaves the source in place', async () => {
        await put_object('version_assets/src/a.png')
        await copy_basenames('version_assets/src/', 'design_assets/dst/', ['a.png'])
        expect(await object_exists('version_assets/src/a.png')).toBe(true)
    })

    it('skips a missing source rather than failing the whole copy', async () => {
        await put_object('version_assets/src/present.png')
        await copy_basenames('version_assets/src/', 'design_assets/dst/',
            ['missing.png', 'present.png'])
        expect(await list_paths('design_assets/dst/'))
            .toEqual(['design_assets/dst/present.png'])
    })

    it('copies nothing for an empty name set', async () => {
        await put_object('version_assets/src/a.png')
        await copy_basenames('version_assets/src/', 'design_assets/dst/', [])
        expect(await list_paths('design_assets/dst/')).toEqual([])
    })
})


describe('sweep_prefix', () => {

    it('deletes what is not in the keep set', async () => {
        await put_object('design_assets/d1/keep.png')
        await put_object('design_assets/d1/drop.png')
        const swept = await at_later_time(PAST_SWEEP_GRACE_MS,
            () => sweep_prefix('design_assets/d1/', new Set(['keep.png'])))
        expect(swept).toBe(1)
        expect(await list_paths('design_assets/d1/')).toEqual(['design_assets/d1/keep.png'])
    })

    it('spares anything created inside the grace period', async () => {
        await put_object('design_assets/d1/fresh.png')
        const swept = await sweep_prefix('design_assets/d1/', new Set())
        expect(swept).toBe(0)
        expect(await object_exists('design_assets/d1/fresh.png')).toBe(true)
    })

    it('does not reach outside its prefix', async () => {
        await put_object('design_assets/d1/mine.png')
        await put_object('design_assets/d2/theirs.png')
        await at_later_time(PAST_SWEEP_GRACE_MS,
            () => sweep_prefix('design_assets/d1/', new Set()))
        expect(await object_exists('design_assets/d2/theirs.png')).toBe(true)
    })

    it('reports zero for an empty prefix', async () => {
        expect(await sweep_prefix('design_assets/nothing/', new Set())).toBe(0)
    })
})


describe('delete_prefix', () => {

    it('removes everything under the prefix', async () => {
        await put_object('design_assets/d1/a.png')
        await put_object('design_assets/d1/b.png')
        await delete_prefix('design_assets/d1/')
        expect(await list_paths('design_assets/d1/')).toEqual([])
    })

    it('ignores an empty prefix', async () => {
        await expect(delete_prefix('design_assets/nothing/')).resolves.toBeUndefined()
    })
})


describe('design_prefixes', () => {

    it('names all three prefixes a design owns', () => {
        expect(design_prefixes('d1')).toEqual(
            ['design_assets/d1/', 'version_assets/d1/', 'design_cache/d1/'])
    })
})


describe('handle_reconcile_assets', () => {

    it('reclaims what the design no longer names', async () => {
        const id = await make_design(design_id => ({
            content_items: {p1: passage_with_image('p1',
                upload_image(`design_assets/${design_id}/used.png`))},
            content_order: ['p1'],
        }))
        await put_object(`design_assets/${id}/used.png`)
        await put_object(`design_assets/${id}/unused.png`)

        const result = await at_later_time(PAST_SWEEP_GRACE_MS,
            () => handle_reconcile_assets(OWNER, id))
        expect(result.status).toBe(200)
        expect(result.body).toEqual({swept: 1})
        expect(await object_exists(`design_assets/${id}/used.png`)).toBe(true)
        expect(await object_exists(`design_assets/${id}/unused.png`)).toBe(false)
    })

    it('never sweeps the frozen snapshots or the derived cache', async () => {
        // version_assets is append-only for a published version's sake; design_cache holds
        // derived files the design doc never names, so sweeping it here would delete all of them
        const id = await make_design()
        await put_object(`version_assets/${id}/frozen.png`)
        await put_object(`design_cache/${id}/derived.png`)
        await at_later_time(PAST_SWEEP_GRACE_MS, () => handle_reconcile_assets(OWNER, id))
        expect(await object_exists(`version_assets/${id}/frozen.png`)).toBe(true)
        expect(await object_exists(`design_cache/${id}/derived.png`)).toBe(true)
    })

    it('re-reads the doc, so a co-editor\'s concurrent addition survives', async () => {
        const id = await make_design()
        await put_object(`design_assets/${id}/added_by_editor.png`)
        // The co-editor's write lands after the requesting client's own view of the design
        await admin_db.doc(`designs/${id}`).update({
            'content_items.p1': passage_with_image('p1',
                upload_image(`design_assets/${id}/added_by_editor.png`)),
            content_order: ['p1'],
        })
        await at_later_time(PAST_SWEEP_GRACE_MS, () => handle_reconcile_assets(OWNER, id))
        expect(await object_exists(`design_assets/${id}/added_by_editor.png`)).toBe(true)
    })

    it('lets any editor trigger it', async () => {
        const id = await make_design({editor_uids: [OWNER, EDITOR]})
        expect((await handle_reconcile_assets(EDITOR, id)).status).toBe(200)
    })

    it('refuses a caller who is not an editor', async () => {
        const id = await make_design()
        await put_object(`design_assets/${id}/a.png`)
        const result = await at_later_time(PAST_SWEEP_GRACE_MS,
            () => handle_reconcile_assets(STRANGER, id))
        expect(result.status).toBe(404)
        expect(await object_exists(`design_assets/${id}/a.png`)).toBe(true)
    })

    it('refuses a design that does not exist', async () => {
        expect((await handle_reconcile_assets(OWNER, new_id())).status).toBe(404)
    })
})


describe('handle_touch_assets', () => {

    it('reports the assets it stamped', async () => {
        // The stamp itself (GCS customTime) can't be asserted here — the Storage emulator
        // accepts the metadata write and drops the field, so only the count and the survival of
        // the object are observable. What the count proves is that the right set was targeted:
        // the design's referenced uploads, and nothing beyond them
        const id = await make_design(design_id => ({
            content_items: {p1: passage_with_image('p1',
                upload_image(`design_assets/${design_id}/pic.png`))},
            content_order: ['p1'],
        }))
        await put_object(`design_assets/${id}/pic.png`)
        await put_object(`design_assets/${id}/unreferenced.png`)

        const result = await handle_touch_assets(OWNER, id)
        expect(result.status).toBe(200)
        expect(result.body).toEqual({touched: 1})
        const [metadata] = await admin_bucket.file(`design_assets/${id}/pic.png`).getMetadata()
        expect(metadata.name).toBe(`design_assets/${id}/pic.png`)
    })

    it('deletes nothing — it is deliberately inert', async () => {
        const id = await make_design()
        await put_object(`design_assets/${id}/unreferenced.png`)
        await handle_touch_assets(OWNER, id)
        expect(await object_exists(`design_assets/${id}/unreferenced.png`)).toBe(true)
    })

    it('survives an asset the doc names but the bucket does not hold', async () => {
        // Best-effort and independent: one unreadable object must not cost the others their stamp
        const id = await make_design(design_id => ({
            content_items: {p1: passage_with_image('p1',
                upload_image(`design_assets/${design_id}/missing.png`))},
            content_order: ['p1'],
        }))
        expect((await handle_touch_assets(OWNER, id)).status).toBe(200)
    })

    it('refuses a caller who is not an editor', async () => {
        const id = await make_design()
        expect((await handle_touch_assets(STRANGER, id)).status).toBe(404)
    })

    it('refuses a design that does not exist', async () => {
        expect((await handle_touch_assets(OWNER, new_id())).status).toBe(404)
    })
})


describe('storage_public_url', () => {

    it('escapes the path so a prefixed object resolves to one object name', () => {
        const url = storage_public_url('design_assets/d1/pic.png')
        expect(url).toContain(encodeURIComponent('design_assets/d1/pic.png'))
        expect(url).toContain('alt=media')
    })

    it('points at the emulator in dev', () => {
        // config.dev is derived from FIRESTORE_EMULATOR_HOST, which the suites set
        expect(storage_public_url('a/b.png').startsWith('http://localhost:9199')).toBe(true)
    })
})


describe('version doc fixtures', () => {

    it('collects nothing from a freshly frozen version with no uploads', () => {
        expect([...collect_version_basenames(version_doc('d1'))]).toEqual([])
    })
})
