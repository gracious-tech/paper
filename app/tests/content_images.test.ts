// Passage images (content_images.ts): where an uploaded image's bytes live as a design is frozen
// into a version and a version turned back into a design, and which variant a painted/torn style
// embeds. The planning is pure path arithmetic over asset_paths.ts's prefixes; Storage, hashing
// and the canvas mask are stand-ins, so what's asserted is the paths and copy jobs that result

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {make_blueprint, make_passage} from './helpers/blueprint'

import type {ContentItem, ContentPassageImage, ContentPictureStory, PictureStorySlide}
    from '@/services/types'


// Storage, and what the module reaches it through
const upload_bytes = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => path,
    uploadBytes: upload_bytes,
}))
vi.mock('@/services/firebase', () => ({firebase_storage: {}}))
vi.mock('@/services/design_assets', () => ({storage_public_url: (path:string) => `url:${path}`}))

// Hashing stays content-based (a stand-in digest of the bytes), so distinct bytes stay distinct
vi.mock('@/services/cover', () => ({
    hash_bytes: async (bytes:Uint8Array) => `h${[...bytes].join('')}`,
}))

// The mask itself needs a canvas; the stand-in tags the bytes with what it was asked to apply
const apply_frame = vi.hoisted(() => vi.fn(async (_image:Blob, style:string, variant:number) =>
    new Blob([new Uint8Array([style.length, variant])])))
vi.mock('@/services/image_frame', () => ({
    is_masked_image_style: (style:string) => style === 'painted' || style === 'torn',
    apply_image_frame: apply_frame,
}))

const {plan_image_into_design, plan_version_images, resolve_content_for_style,
    upload_passage_image} = await import('@/services/content_images')


// An uploaded image at a path, as the content item stores it (hashed by its basename's stem)
function uploaded(path:string, original:ContentPassageImage['original'] = null)
        :ContentPassageImage {
    const hash = path.slice(path.lastIndexOf('/') + 1).replace(/\.\w+$/, '')
    return {source: 'upload', url: `url:${path}`, path, hash, original}
}


// An image from an outside service, which never needs copying
function external(url:string):ContentPassageImage {
    return {source: 'url', url, path: null, hash: null, original: null}
}


// A picture story with a slide per image (null for an unillustrated slide)
function make_story(id:string, images:(ContentPassageImage|null)[]):ContentPictureStory {
    return {type: 'picture_story', id, title: null, title_subtitle: '', title_icon: null,
        slides: images.map((image, index):PictureStorySlide => ({
            id: `${id}_${index}`, image, mode: 'passage', book: 'gen', start_chapter: 1,
            start_verse: 1, end_chapter: 1, end_verse: 1, doc: {type: 'doc', content: []},
        }))}
}


beforeEach(() => {
    upload_bytes.mockClear()
    apply_frame.mockClear()
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('plan_version_images', () => {

    it('freezes an uploaded image into the design\'s version prefix, by basename', () => {
        const blueprint = make_blueprint({content: [
            make_passage('p1', {image: uploaded('design_assets/d1/abc.png')}),
        ]})
        const {frozen, copies} = plan_version_images('d1', blueprint)
        expect(frozen[0]).toMatchObject({image: {source: 'upload',
            path: 'version_assets/d1/abc.png', url: 'url:version_assets/d1/abc.png'}})
        expect(copies).toEqual([{from: 'design_assets/d1/abc.png',
            to: 'version_assets/d1/abc.png', content_type: 'image/png'}])
    })

    it('keeps a path from elsewhere inside this design\'s own prefix', () => {
        // Only the basename is trusted, so a path naming another design still freezes into ours
        const blueprint = make_blueprint({content: [
            make_passage('p1', {image: uploaded('design_assets/someone_else/../x/abc.jpg')}),
        ]})
        const {copies} = plan_version_images('d1', blueprint)
        expect(copies[0]!.to).toBe('version_assets/d1/abc.jpg')
    })

    it('labels each copy by its extension, defaulting to jpeg', () => {
        const blueprint = make_blueprint({content: [
            make_passage('a', {image: uploaded('design_assets/d1/a.WEBP')}),
            make_passage('b', {image: uploaded('design_assets/d1/b.jpg')}),
            make_passage('c', {image: uploaded('design_assets/d1/c.bin')}),
        ]})
        expect(plan_version_images('d1', blueprint).copies.map(copy => copy.content_type))
            .toEqual(['image/webp', 'image/jpeg', 'image/jpeg'])
    })

    it('passes external, missing and pathless images through with nothing to copy', () => {
        const blueprint = make_blueprint({content: [
            make_passage('a', {image: external('https://example.com/x.jpg')}),
            make_passage('b'),
            make_passage('c', {image: {source: 'upload', url: null, path: null, hash: null,
                original: null}}),
        ]})
        const {frozen, copies} = plan_version_images('d1', blueprint)
        expect(copies).toEqual([])
        expect(frozen).toEqual(blueprint.content)
    })

    it('freezes a masked image\'s unmasked original beside it', () => {
        // The render uses the masked copy; turning the version back into a design needs the
        // original, so both have to survive the design changing afterwards
        const original = {source: 'upload' as const, url: 'url:design_assets/d1/orig.jpg',
            path: 'design_assets/d1/orig.jpg', hash: 'orig'}
        const blueprint = make_blueprint({content: [
            make_passage('p1', {image: uploaded('design_cache/d1/painted_v0_orig.png', original)}),
        ]})
        const {frozen, copies} = plan_version_images('d1', blueprint)
        expect(frozen[0]).toMatchObject({image: {path: 'version_assets/d1/painted_v0_orig.png',
            original: {path: 'version_assets/d1/orig.jpg', url: 'url:version_assets/d1/orig.jpg'}}})
        expect(copies.map(copy => copy.to)).toEqual(['version_assets/d1/painted_v0_orig.png',
            'version_assets/d1/orig.jpg'])
    })

    it('freezes every illustrated slide of a picture story', () => {
        const blueprint = make_blueprint({content: [make_story('s', [
            uploaded('design_assets/d1/one.png'), null, external('https://example.com/y.jpg'),
            uploaded('design_assets/d1/two.png'),
        ])]})
        const {frozen, copies} = plan_version_images('d1', blueprint)
        const slides = (frozen[0] as ContentPictureStory).slides
        expect(slides.map(slide => slide.image?.path ?? slide.image?.url ?? null)).toEqual([
            'version_assets/d1/one.png', null, 'https://example.com/y.jpg',
            'version_assets/d1/two.png'])
        expect(copies).toHaveLength(2)
    })

    it('leaves the live blueprint untouched', () => {
        const blueprint = make_blueprint({content: [
            make_passage('p1', {image: uploaded('design_assets/d1/abc.png')}),
            make_story('s', [uploaded('design_assets/d1/one.png')]),
        ]})
        const before = structuredClone(blueprint.content)
        plan_version_images('d1', blueprint)
        expect(blueprint.content).toEqual(before)
    })

})


describe('plan_image_into_design', () => {

    it('brings a frozen image back into the new design\'s own prefix', () => {
        const {image, copies} = plan_image_into_design(uploaded('version_assets/d1/abc.png'), 'd2')
        expect(image).toMatchObject({path: 'design_assets/d2/abc.png',
            url: 'url:design_assets/d2/abc.png', original: null})
        expect(copies).toEqual([{from: 'version_assets/d1/abc.png',
            to: 'design_assets/d2/abc.png', content_type: 'image/png'}])
    })

    it('copies nothing for an image already where it belongs', () => {
        const {image, copies} = plan_image_into_design(uploaded('design_assets/d2/abc.png'), 'd2')
        expect(image.path).toBe('design_assets/d2/abc.png')
        expect(copies).toEqual([])
    })

    it('moves a masked image\'s original too', () => {
        const original = {source: 'upload' as const, url: 'u', path: 'version_assets/d1/orig.jpg',
            hash: 'orig'}
        const {image, copies} = plan_image_into_design(
            uploaded('version_assets/d1/painted.png', original), 'd2')
        expect(image.original).toMatchObject({path: 'design_assets/d2/orig.jpg'})
        expect(copies.map(copy => [copy.to, copy.content_type])).toEqual([
            ['design_assets/d2/painted.png', 'image/png'],
            ['design_assets/d2/orig.jpg', 'image/jpeg'],
        ])
    })

    it('leaves an external image alone', () => {
        const source = external('https://example.com/x.jpg')
        expect(plan_image_into_design(source, 'd2')).toEqual({image: source, copies: []})
    })

})


describe('upload_passage_image', () => {

    it('stores bytes content-addressed in the design\'s prefix, as what they are', async () => {
        // PNG bytes the browser labelled as jpeg
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])
        const image = await upload_passage_image('d1', bytes, 'image/jpeg')
        const path = `design_assets/d1/h${[...bytes].join('')}.png`
        expect(image).toEqual({source: 'upload', url: `url:${path}`, path,
            hash: `h${[...bytes].join('')}`, original: null})
        expect(upload_bytes).toHaveBeenCalledWith(path, bytes, {contentType: 'image/png'})
    })

    it('falls back to the label for bytes it can\'t identify', async () => {
        const image = await upload_passage_image('d1', new Uint8Array([1, 2, 3]), 'image/webp')
        expect(image.path).toMatch(/\.webp$/)
    })

})


describe('resolve_content_for_style', () => {

    // Serve the same bytes for every image fetched
    function serve_images():ReturnType<typeof vi.fn> {
        const fetch = vi.fn(async () => new Response(new Uint8Array([7, 7])))
        vi.stubGlobal('fetch', fetch)
        return fetch
    }

    it('leaves images alone for unmasked styles', async () => {
        const fetch = serve_images()
        const content = [make_passage('p', {image: uploaded('design_assets/r1/a.png')})]
        expect(await resolve_content_for_style('r1', content, 'padded')).toEqual(content)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('masks each image into the design cache, numbering variants in document order', async () => {
        // Passage images then story slides, in order, so the server finds them by the same count
        serve_images()
        const content:ContentItem[] = [
            make_passage('p', {image: uploaded('design_assets/r2/a.png')}),
            make_passage('q'),
            make_story('s', [null, uploaded('design_assets/r2/b.png')]),
        ]
        const resolved = await resolve_content_for_style('r2', content, 'torn')
        expect(apply_frame.mock.calls.map(call => [call[1], call[2]]))
            .toEqual([['torn', 0], ['torn', 1]])
        expect(resolved[0]).toMatchObject({image: {source: 'upload',
            path: 'design_cache/r2/torn_v0_a.png',
            original: {source: 'upload', path: 'design_assets/r2/a.png', hash: 'a'}}})
        expect(resolved[1]).toEqual(content[1])
        expect((resolved[2] as ContentPictureStory).slides[1]!.image)
            .toMatchObject({path: 'design_cache/r2/torn_v1_b.png'})
        expect(upload_bytes).toHaveBeenCalledWith('design_cache/r2/torn_v0_a.png',
            expect.any(Uint8Array), {contentType: 'image/png'})
    })

    it('keeps an already-masked image\'s original rather than masking twice over', async () => {
        serve_images()
        const original = {source: 'upload' as const, url: 'u', path: 'design_assets/r3/o.jpg',
            hash: 'o'}
        const content = [make_passage('p', {image: uploaded('design_cache/r3/x.png', original)})]
        const resolved = await resolve_content_for_style('r3', content, 'painted')
        expect((resolved[0] as {image:ContentPassageImage}).image.original).toEqual(original)
    })

    it('processes an unchanged image once per style and variant', async () => {
        const fetch = serve_images()
        const content = [make_passage('p', {image: uploaded('design_assets/r4/a.png')})]
        await resolve_content_for_style('r4', content, 'painted')
        await resolve_content_for_style('r4', content, 'painted')
        expect(fetch).toHaveBeenCalledTimes(1)
        await resolve_content_for_style('r4', content, 'torn')
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('forgets a failed fetch, so the next resolve retries', async () => {
        const fetch = vi.fn(async () => new Response('', {status: 503}))
        vi.stubGlobal('fetch', fetch)
        const content = [make_passage('p', {image: uploaded('design_assets/r5/a.png')})]
        await expect(resolve_content_for_style('r5', content, 'painted')).rejects.toThrow('503')
        serve_images()
        await expect(resolve_content_for_style('r5', content, 'painted')).resolves.toBeDefined()
    })

})
