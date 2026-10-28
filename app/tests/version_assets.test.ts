// Turning a frozen version's blueprint back into one a live design owns (version_assets.ts):
// the cover background and every passage/story image move from version_assets/ into the
// design's own design_assets/ prefix by the same basename, a masked image comes back as its
// unmasked original, what's already durable is left alone, and a failed copy keeps the design
// usable rather than blocking the duplicate/restore. The path planning is the real
// content_images.ts; only Storage and the copy itself are stand-ins

import {describe, it, expect, beforeEach, vi} from 'vitest'
import {to_design_asset} from 'paper-bible-typst'

import {make_blueprint, make_passage} from './helpers/blueprint'

import type {AssetCopy} from '@/services/design_assets'
import type {Blueprint, ContentPassageImage, ContentPictureStory, CoverConfig, PictureStorySlide}
    from '@/services/types'


// The copy jobs handed over, and where a failure of them goes
const apply_asset_copies = vi.hoisted(() => vi.fn(async (_copies:AssetCopy[]) => undefined))
vi.mock('@/services/design_assets', () => ({
    apply_asset_copies,
    storage_public_url: (path:string) => `url:${path}`,
}))
const report_error = vi.hoisted(() => vi.fn())
vi.mock('@/services/errors', () => ({report_error}))

// What content_images.ts reaches for at import, none of it used by the planning
vi.mock('firebase/storage', () => ({ref: () => null, uploadBytes: async () => undefined}))
vi.mock('@/services/firebase', () => ({firebase_storage: {}}))
vi.mock('@/services/image_frame', () => ({is_masked_image_style: () => false}))

// The cover's own planning, as cover.ts does it (the module itself drags in the worker)
vi.mock('@/services/cover', () => ({
    hash_bytes: async () => 'hash',
    plan_cover_bg_into_design: (path:string, design_id:string) => {
        const moved = to_design_asset(path, design_id)
        return {path: moved, copy: {from: path, to: moved, content_type: 'image/jpeg'}}
    },
}))

const {rehydrate_version_blueprint} = await import('@/services/version_assets')


// An uploaded image at a path, optionally a masked copy of an original
function uploaded(path:string, original:ContentPassageImage['original'] = null)
        :ContentPassageImage {
    return {source: 'upload', url: `url:${path}`, path, hash: 'h', original}
}


// A cover whose background is the given one
function cover_with(bg_image:CoverConfig['bg_image']):CoverConfig {
    return {form: {}, bg_image, font_families: [], title_custom: false} as unknown as CoverConfig
}


// A picture story with a slide per image (null for an unillustrated slide)
function make_story(images:(ContentPassageImage|null)[]):ContentPictureStory {
    return {type: 'picture_story', id: 's1', title: null, title_subtitle: '', title_icon: null,
        slides: images.map((image, index):PictureStorySlide => ({
            id: `sl${index}`, image, mode: 'passage', book: 'gen', start_chapter: 1,
            start_verse: 1, end_chapter: 1, end_verse: 1, doc: {type: 'doc', content: []},
        }))}
}


// The copy jobs the last rehydrate asked for, as from -> to
function copies_made():string[]{
    return apply_asset_copies.mock.calls.flatMap(([copies]) =>
        copies.map(copy => `${copy.from} -> ${copy.to}`))
}


beforeEach(() => {
    apply_asset_copies.mockClear()
    report_error.mockClear()
})


describe('rehydrate_version_blueprint', () => {

    // The snapshot prefix is append-only; a live design needs its own copy to edit and reclaim
    it('moves a frozen custom cover background into the design\'s own prefix', async () => {
        const frozen = make_blueprint({cover: cover_with(
            {kind: 'custom', path: 'version_assets/src/bg1.jpg', hash: 'bg1'})})
        const live = await rehydrate_version_blueprint(frozen, 'd2')
        expect(live.cover!.bg_image).toEqual(
            {kind: 'custom', path: 'design_assets/d2/bg1.jpg', hash: 'bg1'})
        expect(copies_made()).toEqual(['version_assets/src/bg1.jpg -> design_assets/d2/bg1.jpg'])
        // The version's own blueprint is never touched
        expect(frozen.cover!.bg_image).toMatchObject({path: 'version_assets/src/bg1.jpg'})
    })

    // Restoring over the design the freeze came from finds the bytes already where they belong
    it('leaves a background already under this design, and a builtin, as they are', async () => {
        const own = await rehydrate_version_blueprint(make_blueprint({cover: cover_with(
            {kind: 'custom', path: 'design_assets/d1/bg1.jpg', hash: 'bg1'})}), 'd1')
        expect(own.cover!.bg_image).toMatchObject({path: 'design_assets/d1/bg1.jpg'})
        const builtin = await rehydrate_version_blueprint(make_blueprint({cover: cover_with(
            {kind: 'builtin', id: 'meadow.jpg'})}), 'd1')
        expect(builtin.cover!.bg_image).toEqual({kind: 'builtin', id: 'meadow.jpg'})
        expect(copies_made()).toEqual([])
    })

    // Passage images and story slides alike come home, url and all
    it('moves uploaded passage and story images into the design\'s prefix', async () => {
        const frozen = make_blueprint({content: [
            make_passage('p1', {image: uploaded('version_assets/src/a.png')}),
            make_story([uploaded('version_assets/src/b.webp'), null]),
        ]})
        const live = await rehydrate_version_blueprint(frozen, 'd2')
        const passage = live.content[0] as {image:ContentPassageImage}
        expect(passage.image).toMatchObject({path: 'design_assets/d2/a.png',
            url: 'url:design_assets/d2/a.png', original: null})
        const story = live.content[1] as ContentPictureStory
        expect(story.slides[0]!.image).toMatchObject({path: 'design_assets/d2/b.webp'})
        expect(story.slides[1]!.image).toBe(null)
        expect(copies_made()).toEqual([
            'version_assets/src/a.png -> design_assets/d2/a.png',
            'version_assets/src/b.webp -> design_assets/d2/b.webp',
        ])
    })

    // The design's style re-applies the mask, so restoring the masked copy would mask it twice
    it('brings a masked image back as its unmasked original', async () => {
        const masked = uploaded('version_assets/src/masked.png',
            {source: 'upload', url: 'url:version_assets/src/orig.jpg',
                path: 'version_assets/src/orig.jpg', hash: 'orig'})
        const live = await rehydrate_version_blueprint(make_blueprint({content: [
            make_passage('p1', {image: masked})]}), 'd2')
        expect((live.content[0] as {image:ContentPassageImage}).image).toEqual({
            source: 'upload', url: 'url:design_assets/d2/orig.jpg',
            path: 'design_assets/d2/orig.jpg', hash: 'orig', original: null})
        expect(copies_made()).toEqual(['version_assets/src/orig.jpg -> design_assets/d2/orig.jpg'])
    })

    // An outside url needs no copy; a masked one still drops back to its original reference
    it('copies nothing for external images, unmasking one that was masked', async () => {
        const external:ContentPassageImage = {source: 'url', url: 'https://img.test/x.jpg',
            path: null, hash: null, original: null}
        const masked_external = uploaded('version_assets/src/m.png',
            {source: 'url', url: 'https://img.test/y.jpg', path: null, hash: null})
        const live = await rehydrate_version_blueprint(make_blueprint({content: [
            make_passage('p1', {image: external}),
            make_passage('p2', {image: masked_external}),
        ]}), 'd2')
        const images = live.content.map(item => (item as {image:ContentPassageImage}).image)
        expect(images[0]).toEqual(external)
        expect(images[1]).toEqual({source: 'url', url: 'https://img.test/y.jpg', path: null,
            hash: null, original: null})
        expect(copies_made()).toEqual([])
    })

    // A copy that fails is reported, and the design still gets made with what could be planned
    it('reports a failed copy instead of failing the duplicate or restore', async () => {
        const failure = new Error('storage/unauthorized')
        apply_asset_copies.mockRejectedValueOnce(failure)
        const live:Blueprint = await rehydrate_version_blueprint(make_blueprint({content: [
            make_passage('p1', {image: uploaded('version_assets/src/a.png')})]}), 'd2')
        expect(live.content).toHaveLength(1)
        expect(report_error).toHaveBeenCalledWith('silent', failure,
            {context: {stage: 'rehydrate_version_assets'}})
    })

})
