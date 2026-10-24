
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

import {PDFDocument} from 'pdf-lib'
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {compile_svg_preview, compile_pdf_spread_preview, compile_standalone}
    from 'paper-bible-typst-node'
import {generate as generate_cover} from 'bookcover-node'

import {handle_preview, run_preview, parse_preview_body} from '../../server/src/preview.ts'
import {shared_content} from '../../server/src/content.ts'
import {config} from '../../server/src/config.ts'
import {QUOTA_PREVIEW, DAILY_PREVIEW_LIMIT} from '../../server/src/quota.ts'
import {admin_db, admin_bucket, reset_firestore, reset_storage, design_doc, new_id,
    upload_image, passage_with_image, list_paths, OWNER, STRANGER} from '../helpers/server.ts'

import type {GenerateOptions, GenerateResult} from 'bookcover-node'
import type {SvgPage, TypstRequest} from 'paper-bible-typst'
import type {PreviewJob, PreviewLabels} from '../../server/src/preview.ts'


// The renderers, replaced (see the top of this file); everything else in both packages is real
vi.mock('paper-bible-typst-node', async original => ({
    ...await original<typeof import('paper-bible-typst-node')>(),
    compile_svg_preview: vi.fn(),
    compile_pdf_spread_preview: vi.fn(),
    compile_standalone: vi.fn(),
    load_fonts_dir: vi.fn(),
}))
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
const spread_mock = vi.mocked(compile_pdf_spread_preview)
const standalone_mock = vi.mocked(compile_standalone)
const cover_mock = vi.mocked(generate_cover)


// The desktop's notices, as its client sends them
const LABELS:PreviewLabels = {
    inside_cover: "Inside of cover",
    banner_title: "Only a preview",
    banner_subtitle: "Build it for the real thing",
    start_of_preview: "Start of preview",
    end_of_preview: "End of preview",
    build_for_rest: "Build it to see the rest",
}


// A real PDF with the given number of pages, as a renderer would return one
async function pdf_bytes(pages:number):Promise<Uint8Array>{
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++){
        doc.addPage([400, 600])
    }
    return await doc.save()
}


// A compiled page as typst-node returns one
function svg_page(height:number):SvgPage{
    return {inner: `<rect height="${height}"/>`, x: 0, width: 100, height}
}


// What bookcover's generate() does, as far as a preview can tell: a PDF at the output path, or
// for SVG the panels split from the wraparound beside it
async function write_cover(options:GenerateOptions):Promise<GenerateResult>{
    if (options.format === 'svg'){
        const front = path.join(path.dirname(options.output_path), 'front.svg')
        await writeFile(front, '<svg data-panel="front"></svg>')
        return {output_path: options.output_path, split_paths: {front, back: front}}
    }
    await writeFile(options.output_path, await pdf_bytes(1))
    return {output_path: options.output_path}
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
        user_agent: 'test-agent', format: 'svg', section: 'start', ...overrides}
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


// A stored preview's bytes, gunzipped (whether or not the download already undid it)
async function stored(file_path:string):Promise<Buffer>{
    const [bytes] = await admin_bucket.file(file_path).download()
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
}


const original_config = {...config}

beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
    svg_mock.mockReset().mockResolvedValue([svg_page(100), svg_page(101)])
    spread_mock.mockReset().mockImplementation(async () => await pdf_bytes(3))
    standalone_mock.mockReset().mockImplementation(async () => await pdf_bytes(1))
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

    it('takes a phone\'s format alone, always from the start', () => {
        expect(parse_preview_body({format: 'svg', section: 'end', page_count: 40}))
            .toEqual({format: 'svg', section: 'start', page_count: 40})
    })

    it('requires a desktop\'s labels, locale and direction', () => {
        const body = {format: 'pdf', section: 'middle', labels: LABELS, locale: 'pt-BR',
            dir: 'ltr'}
        expect(parse_preview_body(body)).toEqual(
            {format: 'pdf', section: 'middle', labels: LABELS, locale: 'pt-BR', dir: 'ltr'})
        expect(parse_preview_body({...body, labels: undefined})).toBe(null)
        expect(parse_preview_body({...body, labels: {...LABELS, end_of_preview: 3}})).toBe(null)
        expect(parse_preview_body({...body, locale: '"><script>'})).toBe(null)
        expect(parse_preview_body({...body, dir: 'ttb'})).toBe(null)
    })

    it('refuses an unknown format or section, and an essay for a label', () => {
        expect(parse_preview_body({format: 'png'})).toBe(null)
        expect(parse_preview_body({format: 'svg', section: 'all'})).toBe(null)
        expect(parse_preview_body({format: 'pdf', labels: {...LABELS,
            banner_title: 'x'.repeat(301)}, locale: 'en', dir: 'ltr'})).toBe(null)
    })

    it('ignores a page count that isn\'t a sane number', () => {
        expect(parse_preview_body({format: 'svg', page_count: -3})).toEqual(
            {format: 'svg', section: 'start'})
        expect(parse_preview_body({format: 'svg', page_count: '40'})).toEqual(
            {format: 'svg', section: 'start'})
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
            format: 'svg', status: 'pending', path: null, error_id: null})
        // Kept for a day, by the TTL policy on `expires`
        const expires = ((await preview(preview_id))['expires'] as {toMillis():number})
        expect(expires.toMillis() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)

        // An async invocation, carrying everything the job needs and its kind
        const command = lambda_send.mock.calls[0]![0] as {input:{FunctionName:string,
            InvocationType:string, Payload:Uint8Array}}
        expect(command.input.FunctionName).toBe('paper-bible-compile')
        expect(command.input.InvocationType).toBe('Event')
        expect(JSON.parse(new TextDecoder().decode(command.input.Payload))).toMatchObject(
            {kind: 'preview', preview_id, design_id, uid: OWNER, format: 'svg'})
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
            page_estimate: 2, truncated: false, dropped_after: false})
        // Each page a standalone SVG document, in reading order, stored gzipped
        const [metadata] = await admin_bucket.file(file_path).getMetadata()
        expect(metadata.contentType).toBe('application/json')
        expect(metadata.contentEncoding).toBe('gzip')
        const pages = (JSON.parse((await stored(file_path)).toString()) as {pages:string[]}).pages
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

    it('leads with the front cover', async () => {
        const design_id = await make_design({blueprint: with_cover()})
        const job = await make_job(design_id)

        await run_preview(job)

        const doc = await preview(job.preview_id)
        expect(doc['pages']).toBe(3)
        const pages = (JSON.parse((await stored(doc['path'] as string)).toString()) as
            {pages:string[]}).pages
        expect(pages[0]).toBe('<svg data-panel="front"></svg>')
        // Split from the wraparound by bookcover itself
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

    // A desktop's request, with the notices it sends
    const desktop:Partial<PreviewJob> = {format: 'pdf', labels: LABELS, locale: 'en',
        dir: 'ltr'}

    it('stores the spreads with the preview strip, and an estimate from them', async () => {
        const design_id = await make_design()
        const job = await make_job(design_id, desktop)

        await run_preview(job)

        const doc = await preview(job.preview_id)
        const file_path = `design_cache/${design_id}/preview_${job.preview_id}.pdf`
        // Three spreads hold six book pages, and the strip is a page of its own in front
        expect(doc).toMatchObject({status: 'available', path: file_path, pages: 3,
            page_estimate: 6, truncated: false})
        const pdf = await PDFDocument.load(await stored(file_path))
        expect(pdf.getPageCount()).toBe(4)

        // The start strip only, typeset from the labels the client sent in its language
        expect(standalone_mock).toHaveBeenCalledTimes(1)
        const source = standalone_mock.mock.calls[0]![1](['Some Font'])
        expect(source).toContain('Only a preview')
        expect(source).toContain('Build it for the real thing')
    })

    it('merges the cover in front, with the labelled inside-of-cover slot', async () => {
        const design_id = await make_design({blueprint: with_cover()})
        const job = await make_job(design_id, desktop)

        await run_preview(job)

        const doc = await preview(job.preview_id)
        expect(doc['status']).toBe('available')
        // The cover's page, between the strip and the three spreads
        expect((await PDFDocument.load(await stored(doc['path'] as string))).getPageCount())
            .toBe(5)
        const request = spread_mock.mock.calls[0]![0]
        expect(request.preview_cover_label).toBe('Inside of cover')
        expect(spread_mock.mock.calls[0]![2]).toBeInstanceOf(Uint8Array)
        expect(cover_mock.mock.calls[0]![0]).toMatchObject({format: 'pdf'})
    })
})
