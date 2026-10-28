
// An accepted server compile, from dispatch to the outcome on the version doc. This is the path
// a user's book takes whenever their browser couldn't compile it, and nothing waits on it but the
// client's sync of that doc — so every outcome (published, failed, cover failed) has to land
// there in full, the per-user lock has to come off, and the design's own summary has to follow
// only when this is its latest version.
//
// The two renderers are stand-ins: Typst (compile_pdf_from_blueprint) returns a real PDF built
// here, and bookcover's generate() writes one. What they draw is typst-node's and bookcover's
// own suites' business (and e2e/compile.test.ts's); what's under test is everything around them,
// against the real emulators

import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {PDFDocument} from 'pdf-lib'
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {PDF_LIFETIME_MS} from 'paper-bible-typst'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'
import {generate as generate_cover, build_schema} from 'bookcover-node'

import {handle_compile, run_compile} from '../../server/src/compile.ts'
import {claim_compile_lock} from '../../server/src/quota.ts'
import {config} from '../../server/src/config.ts'
import {shared_content} from '../../server/src/content.ts'
import {admin_db, admin_bucket, reset_firestore, reset_storage, design_doc, version_doc, new_id,
    list_paths, OWNER} from '../helpers/server.ts'

import type {CompileJob} from '../../server/src/compile.ts'
import type {GenerateOptions, GenerateResult} from 'bookcover-node'


// compile_pdf_from_blueprint()'s options
type CompileOptions = NonNullable<Parameters<typeof compile_pdf_from_blueprint>[1]>


// The renderers, replaced (see the top of this file); everything else in both packages is real
vi.mock('paper-bible-typst-node', async original => ({
    ...await original<typeof import('paper-bible-typst-node')>(),
    compile_pdf_from_blueprint: vi.fn(),
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


const compile_mock = vi.mocked(compile_pdf_from_blueprint)
const cover_mock = vi.mocked(generate_cover)

// A PNG's signature, enough for sniff_image_mime() to name a background by what it really is
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])


// A real PDF with the given number of pages, as a renderer would return one
async function pdf_bytes(pages:number):Promise<Uint8Array>{
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++){
        doc.addPage()
    }
    return await doc.save()
}


// What bookcover's generate() does, as far as the compile can tell: a PDF at the output path
async function write_cover(options:GenerateOptions):Promise<GenerateResult>{
    await writeFile(options.output_path, await pdf_bytes(1))
    return {output_path: options.output_path}
}


// The options the compiler was called with (the first call)
function compile_options():CompileOptions{
    const options = compile_mock.mock.calls[0]?.[1]
    if (!options){
        throw new Error('The compiler was never called with options')
    }
    return options
}


// A pending version and its design, as /api/compile accepts them. The design names this version
// as its latest unless told otherwise, the case a fresh build is in
async function make_pending({version = {}, latest = true}:{version?:Record<string, unknown>,
        latest?:boolean} = {}):Promise<{id:string, design_id:string}>{
    const design_id = new_id()
    const id = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc({
        latest_version: {status: 'pending', pages: null,
            save_token: latest ? 'save_token_value' : 'a_newer_versions_token'},
    }))
    await admin_db.doc(`versions/${id}`).set(version_doc(design_id, {status: 'pending',
        pdf_path: `versions/${id}/doc.pdf`, ...version}))
    return {id, design_id}
}


// A compile job as the light function hands it over
function job(version_id:string):CompileJob{
    return {uid: OWNER, version_id, client_ip: '203.0.113.9', user_agent: 'test-agent',
        page_count: 40}
}


// A blueprint with a cover, complete enough for cover_form_for_render()
function with_cover(bg_image:unknown):Record<string, unknown>{
    return {
        font_size: 10, content: [], service_id: 'home', size_id: 'a4', booklet: false,
        custom_unit: 'mm', custom_trim_width: 152, custom_trim_height: 229, custom_bleed: 3,
        custom_spine: 10,
        cover: {form: {title1: 'Genesis'}, bg_image, font_families: [], title_custom: false},
    }
}


async function version(id:string):Promise<Record<string, unknown>>{
    return (await admin_db.doc(`versions/${id}`).get()).data()!
}

async function design(id:string):Promise<Record<string, unknown>>{
    return (await admin_db.doc(`designs/${id}`).get()).data()!
}

async function compile_stats(version_id:string):Promise<Record<string, unknown>[]>{
    const snap = await admin_db.collection('compile_stats').where('version_id', '==', version_id)
        .get()
    return snap.docs.map(doc => doc.data())
}

// Whether the user's compile lock is free (claiming it succeeds), releasing it again either way
async function lock_free():Promise<boolean>{
    const free = await claim_compile_lock(OWNER, 'probe_version') === 'claimed'
    await admin_db.doc(`compile_lock/${OWNER}`).delete()
    return free
}

// The error reports in the bucket, parsed
async function error_reports():Promise<Record<string, unknown>[]>{
    const paths = await list_paths('errors/')
    return await Promise.all(paths.map(async path => JSON.parse(
        (await admin_bucket.file(path).download())[0].toString()) as Record<string, unknown>))
}


let assets_dir:string
const original_config = {...config}

beforeEach(async () => {
    await reset_firestore()
    await reset_storage()
    compile_mock.mockReset().mockImplementation(async () => await pdf_bytes(3))
    cover_mock.mockReset().mockImplementation(write_cover)
    lambda_send.mockReset().mockResolvedValue({StatusCode: 202})
    // A builtin background is read from the synced assets tree, so give each test its own
    assets_dir = await mkdtemp(path.join(tmpdir(), 'run_compile_'))
    config.assets_dir = assets_dir
})

afterEach(async () => {
    Object.assign(config, original_config)
    await rm(assets_dir, {recursive: true, force: true})
})


describe('run_compile', () => {

    it('publishes the PDF and marks the version available', async () => {
        const {id, design_id} = await make_pending()
        await claim_compile_lock(OWNER, id)

        await run_compile(job(id))

        const doc = await version(id)
        expect(doc['status']).toBe('available')
        expect(doc['pages']).toBe(3)
        expect(doc['error']).toBe(null)
        expect(doc['cover_status']).toBe(null)
        // The PDF's expiry matches the bucket's lifecycle rule (see PDF_LIFETIME_MS)
        const expires = (doc['pdf_expires'] as {toMillis():number}).toMillis()
        expect(Math.abs(expires - (Date.now() + PDF_LIFETIME_MS))).toBeLessThan(60_000)

        // Published at the path derived from the id, never one the doc named, shown inline
        const file = admin_bucket.file(`versions/${id}/doc.pdf`)
        const [bytes] = await file.download()
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
        const [metadata] = await file.getMetadata()
        expect(metadata.contentType).toBe('application/pdf')
        expect(metadata.contentDisposition).toBe('inline')

        // The design's summary follows its latest version, and the user can compile again
        expect(await design(design_id)).toMatchObject(
            {latest_version: {status: 'available', pages: 3}})
        expect(await lock_free()).toBe(true)
    })

    it('compiles the frozen blueprint with this version\'s own link and title', async () => {
        const {id} = await make_pending({version: {title: 'Ruth for Ruth'}})
        await run_compile(job(id))

        const options = compile_options()
        expect(options.share_url).toBe(`https://paper.bible/v/${id}`)
        expect(options.doc_name).toBe('Ruth for Ruth')
        // The client's page estimate, which the auto binding gutter is sized from
        expect(options.page_count).toBe(40)
    })

    it('records the compile for the offline telemetry', async () => {
        const {id, design_id} = await make_pending()
        await run_compile(job(id))

        // Written without being awaited (it must never hold up or fail the compile)
        await expect.poll(() => compile_stats(id)).toHaveLength(1)
        expect((await compile_stats(id))[0]).toMatchObject({design_id, owner: OWNER,
            engine: 'server', ok: true, pages: 3, estimated_pages: 40, user_agent: 'test-agent',
            gutter_auto: false})
    })

    it('still publishes when the telemetry row can\'t be written', async () => {
        const {id} = await make_pending()
        // compile_stats refuses the write; every other collection is the real one
        const collection = admin_db.collection.bind(admin_db)
        const refuse = vi.spyOn(admin_db, 'collection').mockImplementation(name =>
            name === 'compile_stats'
                ? {add: () => Promise.reject(new Error('quota exceeded'))} as never
                : collection(name))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            await run_compile(job(id))
            expect((await version(id))['status']).toBe('available')
            // The lost row is only logged, after the outcome (it's written without being awaited)
            await expect.poll(() => logged.mock.calls.flat().map(String))
                .toContain('Error: quota exceeded')
        } finally {
            refuse.mockRestore()
            logged.mockRestore()
        }
    })

    it('leaves the design\'s summary alone when regenerating an older version', async () => {
        // A newer version since wrote its own token over the summary
        const {id, design_id} = await make_pending({latest: false})
        await run_compile(job(id))

        expect((await version(id))['status']).toBe('available')
        expect(await design(design_id)).toMatchObject({latest_version: {status: 'pending',
            pages: null, save_token: 'a_newer_versions_token'}})
    })

    it('hands the version\'s snapshotted fonts to the compiler', async () => {
        const {id, design_id} = await make_pending()
        const font_path = `version_assets/${design_id}/font_hash.bin`
        await admin_bucket.file(font_path).save(Buffer.from('font bytes'))
        await admin_db.doc(`versions/${id}`).update({custom_fonts: [
            {family: 'Handwritten', style: 'serif', files: [font_path]}]})

        await run_compile(job(id))

        const fonts = compile_options().custom_fonts ?? []
        expect(fonts.map(font => [font.family, font.style])).toEqual([['Handwritten', 'serif']])
        expect(Buffer.from(fonts[0]!.files[0]!).toString()).toBe('font bytes')
    })

    it('a compile that fails marks the version failed, with a report to quote', async () => {
        const {id, design_id} = await make_pending()
        await claim_compile_lock(OWNER, id)
        compile_mock.mockRejectedValue(new Error('Typst ran out of memory'))

        await run_compile(job(id))

        const doc = await version(id)
        expect(doc['status']).toBe('failed')
        expect(doc['error']).toBe('Typst ran out of memory')
        expect(await design(design_id)).toMatchObject({latest_version: {status: 'failed'}})
        expect(await lock_free()).toBe(true)

        // The id on the doc is a real report, the one a support link quotes
        const reports = await error_reports()
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({id: doc['error_id'], source: 'server',
            severity: 'critical', uid: OWNER, ip: '203.0.113.9', context: {version_id: id}})
        expect(reports[0]!['message']).toContain('Typst ran out of memory')

        // A real attempt that failed is still a row of telemetry
        await expect.poll(() => compile_stats(id)).toHaveLength(1)
        expect((await compile_stats(id))[0]).toMatchObject({ok: false, pages: null})
    })

    it('a failed asset sync fails the version rather than leaving it pending', async () => {
        const {id} = await make_pending()
        await run_compile(job(id), async () => {
            throw new Error('S3 unreachable')
        })

        expect(await version(id)).toMatchObject({status: 'failed', error: 'S3 unreachable'})
        expect(compile_mock).not.toHaveBeenCalled()
        // No compile was attempted, so there's nothing to time
        expect(await compile_stats(id)).toEqual([])
        expect(await lock_free()).toBe(true)
    })

    it('renders the cover after the interior, from the design\'s own background', async () => {
        const {id, design_id} = await make_pending()
        const bg_path = `version_assets/${design_id}/bg_hash.jpg`
        // Stored under a .jpg name but really a PNG: it's handed over named as what it is
        await admin_bucket.file(bg_path).save(PNG_BYTES)
        await admin_db.doc(`versions/${id}`).update({blueprint: with_cover(
            {kind: 'custom', path: bg_path, hash: 'bg_hash'})})
        cover_mock.mockImplementation(async options => {
            expect(await readdir(options.input_path)).toEqual(['background.png'])
            return await write_cover(options)
        })

        await run_compile(job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'available'})
        const [cover] = await admin_bucket.file(`versions/${id}/cover.pdf`).download()
        expect(cover.subarray(0, 5).toString('latin1')).toBe('%PDF-')
        expect(cover_mock).toHaveBeenCalledOnce()
    })

    it('a cover that fails still publishes the interior', async () => {
        const {id} = await make_pending({version: {blueprint: with_cover(null)}})
        cover_mock.mockRejectedValue(new Error('bookcover could not lay out the spine'))

        await run_compile(job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'failed',
            pages: 3})
        expect(await list_paths(`versions/${id}/`)).toEqual([`versions/${id}/doc.pdf`])
        // Reported, but quietly: the user still has their book
        const reports = await error_reports()
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({severity: 'silent',
            context: {version_id: id, stage: 'cover_render'}})
    })

    it('renders a builtin background from the synced assets tree, under its own name', async () => {
        const {id} = await make_pending({version: {blueprint: with_cover(
            {kind: 'builtin', id: 'hills.jpg'})}})
        await mkdir(path.join(assets_dir, 'backgrounds'))
        await writeFile(path.join(assets_dir, 'backgrounds', 'hills.jpg'), PNG_BYTES)
        cover_mock.mockImplementation(async options => {
            // bookcover-node has no fallback lookup for an explicit name, so it must match
            expect(await readdir(options.input_path)).toEqual(['hills.jpg'])
            return await write_cover(options)
        })

        await run_compile(job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'available'})
        // The schema names the file, and the id goes along for bookcover's baked colours
        expect(cover_mock.mock.lastCall![0]).toMatchObject({
            schema: {images: {background: 'hills.jpg'}}, image_builtin: 'hills.jpg'})
    })

    it('a builtin background bookcover no longer ships costs only the cover', async () => {
        // Shaped like a builtin (so the route accepted it), but not one in bookcover's table
        const {id} = await make_pending({version: {blueprint: with_cover(
            {kind: 'builtin', id: 'retired_background.jpg'})}})

        await run_compile(job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'failed'})
        // Refused before its id could become a path, so nothing was rendered from it
        expect(cover_mock).not.toHaveBeenCalled()
    })
})


describe('run_compile, cover only', () => {

    // A published version whose cover the browser couldn't render, handed over for its cover
    async function make_cover_pending(bg_image:unknown = null)
            :Promise<{id:string, design_id:string}>{
        return await make_pending({version: {status: 'available', cover_status: 'pending',
            pages: 48, blueprint: with_cover(bg_image)}})
    }

    // A cover-only compile job
    function cover_job(version_id:string):CompileJob{
        return {...job(version_id), cover_only: true}
    }

    it('publishes the cover from the interior\'s page count, leaving the interior alone',
            async () => {
        const {id} = await make_cover_pending()
        await admin_bucket.file(`versions/${id}/doc.pdf`).save(Buffer.from('the interior'))
        await claim_compile_lock(OWNER, id)

        await run_compile(cover_job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'available',
            pages: 48})
        expect((await version(id))['server_started']).toBeTruthy()
        const [cover] = await admin_bucket.file(`versions/${id}/cover.pdf`).download()
        expect(cover.subarray(0, 5).toString('latin1')).toBe('%PDF-')
        const [interior] = await admin_bucket.file(`versions/${id}/doc.pdf`).download()
        expect(interior.toString()).toBe('the interior')
        expect(compile_mock).not.toHaveBeenCalled()
        // The spine is sized from the published interior
        expect(vi.mocked(build_schema).mock.calls[0]![0]).toMatchObject({page_count: 48})
        expect(await lock_free()).toBe(true)
    })

    it('has bookcover put the copyright statement in place of the blurb\'s marker', async () => {
        // The default cover's blurb: the AUTO-COPYRIGHT marker alone in a paragraph
        const blueprint = {...with_cover(null), bibles: []} as
            {cover:{form:Record<string, unknown>}}
        blueprint.cover.form['blurb'] = {type: 'doc', content: [{type: 'paragraph',
            content: [{type: 'text', text: 'AUTO-COPYRIGHT'}]}]}
        const {id} = await make_pending({version: {status: 'available', cover_status: 'pending',
            pages: 48, blueprint}})
        await admin_bucket.file(`versions/${id}/doc.pdf`).save(Buffer.from('the interior'))
        await claim_compile_lock(OWNER, id)
        // No translations, so the statement needs nothing from fetch.bible
        const init_spy = vi.spyOn(shared_content, 'init').mockResolvedValue()
        const collection_spy = vi.spyOn(shared_content, 'collection', 'get').mockReturnValue(
            {get_resources: () => ({})} as unknown as typeof shared_content.collection)
        try {
            await run_compile(cover_job(id))
        } finally {
            init_spy.mockRestore()
            collection_spy.mockRestore()
        }

        expect(await version(id)).toMatchObject({cover_status: 'available'})
        const options = vi.mocked(build_schema).mock.lastCall![2]
        expect(Object.keys(options!.typst_substitutions!)).toEqual(['AUTO-COPYRIGHT'])
        expect(options!.typst_substitutions!['AUTO-COPYRIGHT']).toMatch(/^#\[[\s\S]*\];$/)
    })

    it('a cover the server can\'t render either is failed, and reported as critical',
            async () => {
        const {id} = await make_cover_pending()
        cover_mock.mockRejectedValue(new Error('bookcover could not lay out the spine'))

        await run_compile(cover_job(id))

        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'failed'})
        const reports = await error_reports()
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({severity: 'critical',
            context: {version_id: id, stage: 'cover_render'}})
        expect(await lock_free()).toBe(true)
    })

    it('a failed asset sync fails the cover rather than leaving it pending', async () => {
        const {id} = await make_cover_pending()
        await run_compile(cover_job(id), async () => {
            throw new Error('S3 unreachable')
        })
        expect(await version(id)).toMatchObject({status: 'available', cover_status: 'failed'})
        expect(cover_mock).not.toHaveBeenCalled()
    })
})


describe('handle_compile, once accepted', () => {

    it('hands the job to the compile function and answers 202', async () => {
        config.compile_function = 'paper-bible-compile'
        const {id} = await make_pending()

        expect(await handle_compile(job(id))).toEqual({status: 202, body: {ok: true}})

        // An async invocation, so the light function answers without waiting on the compile
        const command = lambda_send.mock.calls[0]![0] as {input:Record<string, unknown>}
        expect(command.input).toMatchObject({FunctionName: 'paper-bible-compile',
            InvocationType: 'Event'})
        expect(JSON.parse(new TextDecoder().decode(command.input['Payload'] as Uint8Array)))
            .toEqual(job(id))
        // The server's attempt is stamped (so a dropped job reads as stuck) apart from when the
        // user's wait began, and the lock stays held for the compile to release
        expect((await version(id))['server_started']).toBeTruthy()
        expect((await version(id))['compile_started']).toBeUndefined()
        expect(await claim_compile_lock(OWNER, 'another_version')).toBe('other_version')
        expect(compile_mock).not.toHaveBeenCalled()
    })

    it('a dispatch that fails answers 500 and frees the lock', async () => {
        config.compile_function = 'paper-bible-compile'
        lambda_send.mockRejectedValue(new Error('throttled'))
        const {id} = await make_pending()

        expect(await handle_compile(job(id))).toEqual(
            {status: 500, body: {error: 'dispatch_failed'}})
        expect(await lock_free()).toBe(true)
    })

    it('from source, a server with the compile role runs the compile itself', async () => {
        // Dev's default: both roles on one process, and no function to invoke
        config.compile_function = null
        config.roles = ['light', 'compile']
        const {id} = await make_pending()

        expect(await handle_compile(job(id))).toEqual({status: 202, body: {ok: true}})
        await expect.poll(async () => (await version(id))['status']).toBe('available')
        expect(lambda_send).not.toHaveBeenCalled()
    })

    it('a light-only server with no function to invoke refuses rather than drop the job',
            async () => {
        // A light Lambda is frozen once it answers, so running the compile there would lose it
        config.compile_function = null
        config.roles = ['light']
        const {id} = await make_pending()

        expect(await handle_compile(job(id))).toEqual(
            {status: 500, body: {error: 'dispatch_failed'}})
        expect(compile_mock).not.toHaveBeenCalled()
        expect(await lock_free()).toBe(true)
    })
})
