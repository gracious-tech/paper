
// Previews made on the server, for devices that can't compile in their browser (see preview.ts).
// The route only checks a design and hands the job over, so every refusal is decided there; the
// preview itself records its outcome on a previews/{id} doc, which is all the client ever hears.
//
// The renderers are stand-ins, as in run_compile.test.ts: Typst's (typst-node's preview compiles)
// and bookcover's generate(). Bible content resolution is too, since it would fetch from
// fetch.bible. What's under test is everything around them, against the real emulators

import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {compile_svg_preview} from 'paper-bible-typst-node'
import {truncate_for_preview, PREVIEW_CHAR_LIMIT, ESTIMATE_CHAR_LIMIT} from 'paper-bible-typst'
import {generate as generate_cover} from 'bookcover-node'

import {handle_preview, run_preview, parse_preview_body} from '../../server/src/preview.ts'
import {shared_content} from '../../server/src/content.ts'
import {config} from '../../server/src/config.ts'
import {QUOTA_PREVIEW, DAILY_PREVIEW_LIMIT} from '../../server/src/quota.ts'
import {admin_db, admin_bucket, reset_firestore, reset_storage, design_doc, new_id,
    upload_image, passage_with_image, list_paths, OWNER, STRANGER} from '../helpers/server.ts'

import type {GenerateOptions, GenerateResult} from 'bookcover-node'
import type {PreviewPages, SvgPage, TypstRequest} from 'paper-bible-typst'
import type {PreviewJob} from '../../server/src/preview.ts'


// The renderers, replaced (see the top of this file); everything else in both packages is real
vi.mock('paper-bible-typst-node', async original => ({
    ...await original<typeof import('paper-bible-typst-node')>(),
    compile_svg_preview: vi.fn(),
    load_fonts_dir: vi.fn(),
}))
// The window a preview keeps, real unless a test needs a long document's
vi.mock('paper-bible-typst', async original => {
    const real = await original<typeof import('paper-bible-typst')>()
    return {...real, truncate_for_preview: vi.fn(real.truncate_for_preview)}
})
vi.mock('bookcover-node', async original => ({
    ...await original<typeof import('bookcover-node')>(),
    generate: vi.fn(),
    build_schema: vi.fn(() => ({})),
}))

// The compile function's invoke, which only the light role ever makes
const lambda_send = vi.hoisted(() => vi.fn())
vi.mock('@aws-sdk/client-lambda', () => ({
    LambdaClient: class {
        send = lambda_send
    },
    InvokeCommand: class {
        input:unknown
        constructor(input:unknown){
            this.input = input
        }
    },
}))


const svg_mock = vi.mocked(compile_svg_preview)
const truncate_mock = vi.mocked(truncate_for_preview)
const cover_mock = vi.mocked(generate_cover)


// A compiled page as typst-node returns one
function svg_page(height:number):SvgPage{
    return {inner: `<rect height="${height}"/>`, x: 0, width: 100, height}
}


// What bookcover's generate() does, as far as a preview can tell: the wraparound at its output
// path (1000 x 500pt, bleed included), and the panels split from it written beside it
async function write_cover(options:GenerateOptions):Promise<GenerateResult>{
    await writeFile(options.output_path, '<svg viewBox="0 0 1000 500" width="1000pt"'
        + ' height="500pt" data-panel="wraparound"><rect/></svg>')
    const panel = async (name:string) => {
        const panel_path = path.join(path.dirname(options.output_path), `${name}.svg`)
        await writeFile(panel_path, `<svg data-panel="${name}"></svg>`)
        return panel_path
    }
    return {output_path: options.output_path,
        split_paths: {front: await panel('front'), back: await panel('back')}}
}


// A blueprint's split fields with a cover, complete enough for cover_form_for_render()
function with_cover(bg_image:unknown = null):Record<string, unknown>{
    return {
        font_size: 10, service_id: 'home', size_id: 'a4', booklet: false,
        custom_unit: 'mm', custom_trim_width: 152, custom_trim_height: 229, custom_bleed: 3,
        custom_spine: 10,
        cover: {form: {title1: 'Genesis'}, bg_image, font_families: [], title_custom: false},
    }
}


// A design the owner can edit, with any overrides to its doc
async function make_design(overrides:Record<string, unknown> = {}):Promise<string>{
    const design_id = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc(overrides))
    return design_id
}


// A preview request as the route passes it on (a phone's, unless told otherwise)
function request(design_id:string, overrides:Partial<PreviewJob> = {}):Omit<PreviewJob,
        'preview_id'>{
    return {kind: 'preview', uid: OWNER, design_id, client_ip: '203.0.113.9',
        user_agent: 'test-agent', size: 'phone', section: 'start', ...overrides}
}


// A pending preview doc and the job that makes it, as handle_preview leaves them
async function make_job(design_id:string, overrides:Partial<PreviewJob> = {})
        :Promise<PreviewJob>{
    const preview_id = new_id()
    await admin_db.doc(`previews/${preview_id}`).set({owner: OWNER, design_id,
        status: 'pending'})
    return {...request(design_id, overrides), preview_id}
}


async function preview(id:string):Promise<Record<string, unknown>>{
    return (await admin_db.doc(`previews/${id}`).get()).data()!
}


// A stored preview, gunzipped (whether or not the download already undid it) and parsed
async function stored_preview(file_path:string):Promise<PreviewPages>{
    const [bytes] = await admin_bucket.file(file_path).download()
    const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
    return JSON.parse(json.toString()) as PreviewPages
}


const original_config = {...config}

beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
    svg_mock.mockReset().mockResolvedValue([svg_page(100), svg_page(101)])
    cover_mock.mockReset().mockImplementation(write_cover)
    lambda_send.mockReset().mockResolvedValue({StatusCode: 202})
    // Resolving would fetch the Bible from fetch.bible: an empty document fits any window
    vi.spyOn(shared_content, 'init').mockResolvedValue(undefined)
    vi.spyOn(shared_content, 'resolve').mockImplementation(async () =>
        ({page: {width: '400pt', height: '600pt'}, content: []}) as unknown as TypstRequest)
})

afterEach(() => {
    Object.assign(config, original_config)
    vi.restoreAllMocks()
})


describe('parse_preview_body', () => {

    it('takes a phone\'s preview always from the start', () => {
        expect(parse_preview_body({size: 'phone', section: 'end', page_count: 40}))
            .toEqual({size: 'phone', section: 'start', page_count: 40})
    })

    it('takes a desktop\'s window where it asks', () => {
        expect(parse_preview_body({size: 'desktop', section: 'middle'}))
            .toEqual({size: 'desktop', section: 'middle'})
        expect(parse_preview_body({size: 'desktop'})).toEqual({size: 'desktop', section: 'start'})
    })

    it('refuses an unknown size or section', () => {
        expect(parse_preview_body({size: 'tablet'})).toBe(null)
        expect(parse_preview_body({})).toBe(null)
        expect(parse_preview_body({size: 'desktop', section: 'all'})).toBe(null)
    })

    it('ignores a page count that isn\'t a sane number', () => {
        expect(parse_preview_body({size: 'phone', page_count: -3})).toEqual(
            {size: 'phone', section: 'start'})
        expect(parse_preview_body({size: 'phone', page_count: '40'})).toEqual(
            {size: 'phone', section: 'start'})
    })
})


describe('handle_preview', () => {

    it('refuses an unknown design', async () => {
        expect(await handle_preview(request('no_such_design')))
            .toEqual({status: 404, body: {error: 'unknown_design'}})
    })

    it('refuses someone who can\'t edit the design', async () => {
        const design_id = await make_design()
        expect(await handle_preview(request(design_id, {uid: STRANGER})))
            .toEqual({status: 403, body: {error: 'not_editor'}})
    })

    it('refuses a font outside the design\'s own uploads', async () => {
        const design_id = await make_design({fonts: {f1: {family: 'Stolen', style: 'serif',
            files: ['design_assets/another_design/font.bin']}}})
        expect(await handle_preview(request(design_id)))
            .toEqual({status: 400, body: {error: 'bad_font_path'}})
    })

    it('refuses a cover background outside the design\'s own uploads', async () => {
        const design_id = await make_design({blueprint: with_cover(
            {kind: 'custom', path: 'versions/someone_else/doc.pdf'})})
        expect(await handle_preview(request(design_id)))
            .toEqual({status: 400, body: {error: 'bad_cover_path'}})
    })

    it('refuses an image address a server mustn\'t fetch', async () => {
        const design_id = await make_design({content_items: {p1: passage_with_image('p1',
            {source: 'url', url: 'http://169.254.169.254/latest', path: null, hash: null,
                original: null})}, content_order: ['p1']})
        config.dev = false
        expect(await handle_preview(request(design_id)))
            .toEqual({status: 400, body: {error: 'bad_image_url'}})
    })

    it('refuses once the day\'s previews are spent', async () => {
        const design_id = await make_design()
        const day = new Date().toISOString().slice(0, 10)
        await admin_db.doc(`${QUOTA_PREVIEW}/${OWNER}`).set(
            {day, count: DAILY_PREVIEW_LIMIT})
        expect(await handle_preview(request(design_id)))
            .toEqual({status: 429, body: {error: 'quota_exceeded'}})
        // Nothing to listen to was made
        expect((await admin_db.collection('previews').get()).size).toBe(0)
    })

    it('creates the doc to listen to and hands the job to the compile function', async () => {
        const design_id = await make_design()
        config.compile_function = 'paper-bible-compile'

        const result = await handle_preview(request(design_id))

        expect(result.status).toBe(202)
        const preview_id = (result.body as {preview_id:string}).preview_id
        expect(await preview(preview_id)).toMatchObject({owner: OWNER, design_id,
            size: 'phone', status: 'pending', path: null, error_id: null})
        // Kept for a day, by the TTL policy on `expires`
        const expires = ((await preview(preview_id))['expires'] as {toMillis():number})
        expect(expires.toMillis() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)

        // An async invocation, carrying everything the job needs and its kind
        const command = lambda_send.mock.calls[0]![0] as {input:{FunctionName:string,
            InvocationType:string, Payload:Uint8Array}}
        expect(command.input.FunctionName).toBe('paper-bible-compile')
        expect(command.input.InvocationType).toBe('Event')
        expect(JSON.parse(new TextDecoder().decode(command.input.Payload))).toMatchObject(
            {kind: 'preview', preview_id, design_id, uid: OWNER, size: 'phone'})
    })

    it('marks the preview failed when it can\'t be handed over', async () => {
        const design_id = await make_design()
        config.compile_function = 'paper-bible-compile'
        lambda_send.mockRejectedValue(new Error('throttled'))

        const result = await handle_preview(request(design_id))

        expect(result).toEqual({status: 500, body: {error: 'dispatch_failed'}})
        const docs = (await admin_db.collection('previews').get()).docs
        expect(docs.map(doc => doc.data()['status'])).toEqual(['failed'])
    })
})


describe('run_preview (phone)', () => {

    it('stores the pages and records the outcome', async () => {
        const design_id = await make_design()
        const job = await make_job(design_id)

        await run_preview(job)

        const doc = await preview(job.preview_id)
        const file_path = `design_cache/${design_id}/preview_${job.preview_id}.json`
        expect(doc).toMatchObject({status: 'available', path: file_path, pages: 2,
            page_estimate: 2, truncated: false, dropped_before: false, dropped_after: false})
        // Each page a standalone SVG document, in reading order, stored gzipped
        const [metadata] = await admin_bucket.file(file_path).getMetadata()
        expect(metadata.contentType).toBe('application/json')
        expect(metadata.contentEncoding).toBe('gzip')
        const output = await stored_preview(file_path)
        expect(output.covers).toEqual([])
        const pages = output.pages
        expect(pages).toHaveLength(2)
        expect(pages[0]).toMatch(/^<svg [^>]*viewBox="0 0 100 100"/)
        expect(pages[1]).toContain('<rect height="101"/>')
    })

    it('resolves the design as it is, with its own link and the client\'s estimate', async () => {
        const design_id = await make_design({name: 'Psalms for Sam'})
        const job = await make_job(design_id, {page_count: 64})

        await run_preview(job)

        const [blueprint, , , share_url, page_count] = vi.mocked(shared_content.resolve)
            .mock.calls[0]!
        expect(blueprint.name).toBe('Psalms for Sam')
        expect(share_url).toBe(`https://paper.bible/designs/${design_id}`)
        expect(page_count).toBe(64)
    })

    it('leads with the cover\'s front panel, then its back', async () => {
        const design_id = await make_design({blueprint: with_cover()})
        const job = await make_job(design_id)

        await run_preview(job)

        const doc = await preview(job.preview_id)
        expect(doc['pages']).toBe(2)
        const output = await stored_preview(doc['path'] as string)
        expect(output.covers).toEqual(['<svg data-panel="front"></svg>',
            '<svg data-panel="back"></svg>'])
        // Split from the wraparound by bookcover itself, its spine sized from the estimate
        expect(cover_mock.mock.calls[0]![0]).toMatchObject({format: 'svg', split: true})
    })

    it('swaps in the masked variant of a painted image, where the browser made one', async () => {
        // Two uploads under the design's own prefix, hashed as the app hashes them
        const design_id = new_id()
        const image = (hash:string) => ({...upload_image(`design_assets/${design_id}/${hash}.png`),
            hash})
        await admin_db.doc(`designs/${design_id}`).set(design_doc({
            blueprint: {font_size: 10, cover: null, image_style: 'painted'},
            content_items: {p1: passage_with_image('p1', image('one')),
                p2: passage_with_image('p2', image('two'))},
            content_order: ['p1', 'p2'],
        }))
        // Only the second image's variant exists, numbered by its position among the images
        const variant = `design_cache/${design_id}/painted_v1_two.png`
        await admin_bucket.file(variant).save(Buffer.from('png'), {contentType: 'image/png'})
        const job = await make_job(design_id)

        await run_preview(job)

        const resolved = vi.mocked(shared_content.resolve).mock.calls[0]![0]
        const images = resolved.content.map(item => item.type === 'passage' ? item.image : null)
        expect(images[0]?.path).toBe(`design_assets/${design_id}/one.png`)
        expect(images[1]?.path).toBe(variant)
        expect(images[1]?.url).toContain(encodeURIComponent(variant))
    })

    it('records the failure and an error report when the compile fails', async () => {
        const design_id = await make_design()
        const job = await make_job(design_id)
        svg_mock.mockRejectedValue(new Error('Typst exploded'))

        await run_preview(job)

        const doc = await preview(job.preview_id)
        expect(doc['status']).toBe('failed')
        expect(doc['error_id']).toEqual(expect.any(String))
        await expect.poll(async () => await list_paths(`errors/`), {timeout: 5000})
            .not.toHaveLength(0)
        // And the attempt in the telemetry, with how long it ran (found by its design, since an
        // earlier test's row is written without being awaited and may land after the reset)
        await expect.poll(async () => (await admin_db.collection('compile_stats')
            .where('design_id', '==', design_id).get()).docs.map(row => row.data()['ok']),
            {timeout: 5000}).toEqual([false])
    })

    it('fails rather than previewing a design the caller has since lost', async () => {
        const design_id = await make_design()
        const job = await make_job(design_id)
        await admin_db.doc(`designs/${design_id}`).update({editor_uids: [STRANGER]})

        await run_preview(job)

        expect((await preview(job.preview_id))['status']).toBe('failed')
        expect(svg_mock).not.toHaveBeenCalled()
    })

    it('fails inside its own handling when the asset sync does', async () => {
        const design_id = await make_design()
        const job = await make_job(design_id)

        await run_preview(job, async () => {
            throw new Error('S3 unreachable')
        })

        expect((await preview(job.preview_id))['status']).toBe('failed')
    })
})


describe('run_preview (desktop)', () => {

    it('leads with the whole cover, its bleed cropped off and its folds marked', async () => {
        // A custom size, with 3mm of bleed and a 10mm spine (see with_cover)
        const design_id = await make_design({blueprint: {...with_cover(), service_id: 'custom'}})
        await run_preview(await make_job(design_id, {size: 'desktop'}))

        const doc = (await admin_db.collection('previews').get()).docs[0]!.data()
        const covers = (await stored_preview(doc['path'] as string)).covers
        expect(covers).toHaveLength(1)
        const cover = covers[0]!
        expect(cover).toContain('data-panel="wraparound"')
        // Cropped in from the bleed on every side
        const [x, y] = /viewBox="([^"]+)"/.exec(cover)![1]!.split(' ').map(Number)
        expect(x).toBeCloseTo(3 / 25.4 * 72)
        expect(y).toBeCloseTo(3 / 25.4 * 72)
        // A guide line on each side of the spine
        expect(cover.match(/<line /g)).toHaveLength(2)
    })

    it('keeps the window the desktop asked for, with no cover once the start is left out',
            async () => {
        const design_id = await make_design({blueprint: with_cover()})
        const job = await make_job(design_id, {size: 'desktop', section: 'end'})
        // A long document's end: what came before was dropped, half the document kept
        truncate_mock.mockImplementationOnce(request => ({request, truncated: true,
            dropped_before: true, dropped_after: false, total_chars: 200, window_chars: 100}))

        await run_preview(job)

        // The desktop's larger window, positioned where it asked
        expect(truncate_mock).toHaveBeenCalledWith(expect.anything(), 'end', PREVIEW_CHAR_LIMIT)
        const doc = await preview(job.preview_id)
        // Two pages from half the document estimate four in all
        expect(doc).toMatchObject({status: 'available', page_estimate: 4, truncated: true,
            dropped_before: true, dropped_after: false})
        const output = await stored_preview(doc['path'] as string)
        expect(output.covers).toEqual([])
    })

    it('gives a phone the smaller window', async () => {
        const design_id = await make_design()
        await run_preview(await make_job(design_id))
        expect(truncate_mock).toHaveBeenCalledWith(expect.anything(), 'start',
            ESTIMATE_CHAR_LIMIT)
    })
})
