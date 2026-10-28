
// The build write side (version_compile.ts) through its failures and races: what a version doc,
// its cover and the design's latest_version summary end up saying, and whether the server is
// asked, when the browser compile fails, a cover can't be rendered, the server can't be reached
// or refuses, another attempt got there first, or a dead compile's PDF is already uploaded. The
// journeys take the main paths end to end; Firestore is an in-memory fake here (see
// helpers/fake_firestore.ts), and Storage, the API, the compiler and the cover renderer are
// stand-ins

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {fake_db} from './helpers/fake_firestore'
import {make_blueprint} from './helpers/blueprint'
import {bible_content, set_translations} from './stubs/content'
import {ApiError, ApiOfflineError} from '@/services/api'
import {version_progress, build_requests} from '@/services/compile_progress'
import {STUCK_MS} from '@/services/versions'
import {create_pending_version, compile_and_upload, regenerate_version, regenerate_cover,
    retry_version, resume_abandoned_versions} from '@/services/version_compile'

import type {Blueprint, Version} from '@/services/types'
import type {VersionCompileJob} from '@/services/version_compile'


// The collaborators each test drives
const mocks = vi.hoisted(() => ({
    api: vi.fn(async (..._args:unknown[]):Promise<unknown> => ({})),
    upload: vi.fn(async (..._args:unknown[]):Promise<unknown> => ({})),
    download_url: vi.fn(async (ref:{path:string}):Promise<string> => `https://files/${ref.path}`),
    render_cover: vi.fn(async (..._args:unknown[]) => new Uint8Array([7])),
    report_error: vi.fn((..._args:unknown[]) => 'report_1'),
    alert: vi.fn(async (..._args:unknown[]) => undefined),
    generator: {value: null as unknown},
    is_mobile: vi.fn(() => false),
    server_mode: vi.fn(() => false),
    device_failure: vi.fn((_error:unknown) => false),
    switch_to_server: vi.fn(),
    provisional: vi.fn(() => false),
    settle: vi.fn(),
    end_job: vi.fn(),
    release_page: vi.fn(),
    design_id: {value: null as string|null},
    // The is-it-the-network test each retry_network call was given
    retry_tests: [] as ((error:unknown) => boolean)[],
}))

vi.mock('firebase/firestore', async () => (await import('./helpers/fake_firestore')).module)
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => ({path}),
    uploadBytes: mocks.upload,
    getDownloadURL: mocks.download_url,
}))
vi.mock('@/services/firebase', () => ({firestore: {}, firebase_storage: {}, firebase_auth: {}}))
vi.mock('@/services/api', async importOriginal => ({
    ...await importOriginal<object>(),
    api: mocks.api,
}))
vi.mock('@/services/auth', () => ({user: {value: {uid: 'me'}}}))
vi.mock('@/services/designs', () => ({
    design_display_name: (_blueprint:Blueprint, name_auto:string) => name_auto || 'Untitled',
    gen_name_auto: () => 'Generated name',
    current_design_id: mocks.design_id,
    designs: [],
    until_listed: async () => undefined,
}))
vi.mock('@/services/typst', () => ({typst_generator: mocks.generator}))
vi.mock('@/services/display', () => ({is_mobile_now: mocks.is_mobile}))
vi.mock('@/services/custom_fonts', () => ({
    plan_version_fonts: () => ({copies: [], meta: []}),
    fonts_for_blueprint: () => [],
    load_font_from_meta: async (meta:{family:string}) => ({family: meta.family, files: []}),
}))
vi.mock('@/services/design_assets', () => ({apply_asset_copies: async () => undefined}))
vi.mock('@/services/cover', () => ({
    plan_version_cover: (_id:string, blueprint:Blueprint) => ({copies: [], frozen: blueprint.cover}),
    render_cover_pdf: mocks.render_cover,
}))
vi.mock('@/services/content_images', () => ({
    plan_version_images: (_id:string, blueprint:Blueprint) =>
        ({copies: [], frozen: blueprint.content}),
}))
vi.mock('@/services/state', async importOriginal => ({
    ...await importOriginal<object>(),
    DEFAULT_PAGE_GUESS: 300,
    alert_dialog: mocks.alert,
}))
vi.mock('@/services/errors', () => ({
    report_error: mocks.report_error,
    error_to_string: (error:unknown) => String(error),
}))
vi.mock('@/services/compile_progress', async importOriginal => ({
    ...await importOriginal<object>(),
    hold_page: () => mocks.release_page,
}))
vi.mock('@/services/network_retry', () => ({
    retry_network: (attempt:() => Promise<unknown>, is_network:(error:unknown) => boolean) => {
        mocks.retry_tests.push(is_network)
        return attempt()
    },
}))
vi.mock('@/services/compile_mode', () => ({
    compiles_on_server: mocks.server_mode,
    is_device_failure: mocks.device_failure,
    switch_to_server: mocks.switch_to_server,
    switch_provisional: mocks.provisional,
    settle_server_mode: mocks.settle,
    begin_browser_job: () => mocks.end_job,
}))


// A cover config — its contents are only ever handed to the (stand-in) renderer
const COVER = {form: {}} as unknown as NonNullable<Blueprint['cover']>

// A compiler that succeeds, counting 12 pages, until a test says otherwise
const make_generator = () => ({
    compile_pdf: vi.fn(async (..._args:unknown[]) => ({bytes: new Uint8Array([1]), pages: 12})),
    page_count: vi.fn(async (_bytes:Uint8Array) => 8),
    release_memory: vi.fn(),
})
let generator = make_generator()


// A version as the versions list would hold it
function make_version(overrides:Partial<Version> = {}):Version {
    return {
        id: 'v1', design_id: 'd1', owner: 'me', created: new Date(), compile_started: null,
        server_started: null, title: 'My Bible', blueprint: make_blueprint(), status: 'pending',
        cover_status: null, cover_render_version: null, pages: null,
        pdf_path: 'versions/v1/doc.pdf', pdf_expires: null, copied_from: null, custom_fonts: [],
        save_token: 'tok', error: null, error_id: null, wizard_draft: null, simple_mode: false,
        ...overrides,
    }
}


// The job compile_and_upload takes for a version
function make_job(version:Version):VersionCompileJob {
    return {id: version.id, design_id: version.design_id, blueprint: version.blueprint,
        save_token: version.save_token, fonts: [], page_estimate: 40, title: version.title}
}


// Seed a version's doc and its design (whose summary names this version as latest)
function seed(version:Version, design_token = version.save_token):void{
    fake_db.docs.set(`versions/${version.id}`, {status: version.status,
        cover_status: version.cover_status, pages: version.pages})
    fake_db.docs.set(`designs/${version.design_id}`, {save_token: design_token,
        name_auto: 'Genesis', latest_version: {status: version.status, pages: null,
            save_token: version.save_token}})
}


// A doc's current fields
const stored = (path:string) => fake_db.docs.get(path) as Record<string, unknown>
const summary = (design_id = 'd1') =>
    stored(`designs/${design_id}`)['latest_version'] as Record<string, unknown>

// What the API was asked, as [path, body] pairs
const api_calls = () => mocks.api.mock.calls.map(([path, body]) => [path, body])

// Every context a report was filed with, by stage
const reported_stages = () => mocks.report_error.mock.calls
    .map(call => ((call[2] as {context?:{stage?:string}}|undefined)?.context?.stage))


beforeEach(() => {
    fake_db.reset()
    vi.clearAllMocks()
    generator = make_generator()
    mocks.generator.value = generator
    mocks.api.mockImplementation(async () => ({}))
    mocks.upload.mockImplementation(async () => ({}))
    mocks.download_url.mockImplementation(async ref => `https://files/${ref.path}`)
    mocks.render_cover.mockImplementation(async () => new Uint8Array([7]))
    mocks.is_mobile.mockReturnValue(false)
    mocks.server_mode.mockReturnValue(false)
    mocks.device_failure.mockReturnValue(false)
    mocks.provisional.mockReturnValue(false)
    mocks.design_id.value = null
    mocks.retry_tests = []
    Object.assign(bible_content, {resolve: vi.fn(async () => ({}))})
    set_translations(make_blueprint().bibles)
    for (const key of Object.keys(version_progress)){
        delete version_progress[key]
    }
    for (const key of Object.keys(build_requests)){
        delete build_requests[key]
    }
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})


describe('create_pending_version', () => {

    it('freezes the design\'s own token and name, and marks the design\'s summary pending', async () => {
        fake_db.docs.set('designs/d1', {save_token: 'design_tok', name_auto: 'Genesis'})
        const job = await create_pending_version('d1', make_blueprint(), 'v9', 40, null)
        expect(job).toMatchObject({id: 'v9', save_token: 'design_tok', title: 'Genesis'})
        expect(stored('versions/v9')).toMatchObject({status: 'pending', owner: 'me',
            save_token: 'design_tok', pdf_path: 'versions/v9/doc.pdf', cover_render_version: null})
        expect(summary()).toEqual({status: 'pending', pages: null, save_token: 'design_tok'})
    })

    it('still makes the version when the summary can\'t be written', async () => {
        fake_db.docs.set('designs/d1', {save_token: 'design_tok'})
        fake_db.fail('update', 'designs/d1')
        await create_pending_version('d1', make_blueprint(), 'v9', 40, 'own_tok')
        // A blueprint the design moved on from takes its own token and a generated name
        expect(stored('versions/v9')).toMatchObject({status: 'pending', save_token: 'own_tok',
            title: 'Generated name'})
        expect(reported_stages()).toEqual(['latest_version_summary'])
    })

})


describe('compile_and_upload', () => {

    it('publishes the PDF and the cover, and the summary follows', async () => {
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        await compile_and_upload(make_job(version))
        expect(mocks.upload.mock.calls.map(([ref]) => (ref as {path:string}).path))
            .toEqual(['versions/v1/doc.pdf', 'versions/v1/cover.pdf'])
        expect(stored('versions/v1')).toMatchObject({status: 'available', pages: 12,
            cover_status: 'available', error: null})
        expect(summary()).toMatchObject({status: 'available', pages: 12})
        expect(fake_db.added.get('compile_stats')).toMatchObject([{ok: true, pages: 12}])
        expect(mocks.api).not.toHaveBeenCalled()
        expect(version_progress).toEqual({})
    })

    it('shows the compile\'s progress while it runs, and nothing once it\'s done', async () => {
        const seen:unknown[] = []
        generator.compile_pdf.mockImplementation(async (_request, on_progress) => {
            (on_progress as (event:unknown) => void)({stage: 'compile', i: 1, total: 2})
            seen.push({...version_progress})
            return {bytes: new Uint8Array([1]), pages: 12}
        })
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(seen).toEqual([{v1: {stage: 'compile', i: 1, total: 2}}])
        expect(version_progress).toEqual({})
    })

    it('compiles nothing on a device that builds on the server, handing it straight over', async () => {
        mocks.server_mode.mockReturnValue(true)
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(generator.compile_pdf).not.toHaveBeenCalled()
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', page_count: 40}]])
        // Not a failure, so nothing is reported or logged
        expect(mocks.report_error).not.toHaveBeenCalled()
        expect(fake_db.added.get('compile_stats')).toBeUndefined()
    })

    it('retries only what failed for want of a connection', async () => {
        const version = make_version()
        seed(version)
        mocks.server_mode.mockReturnValue(true)
        await compile_and_upload(make_job(version))
        mocks.server_mode.mockReturnValue(false)
        stored('versions/v1')['status'] = 'pending'
        await compile_and_upload(make_job(version))
        const [server_test, upload_test] = mocks.retry_tests

        // The server: never reached, or its gateway couldn't take it just then
        expect(server_test!(new ApiOfflineError('/api/compile', new Error('offline')))).toBe(true)
        expect(server_test!(new ApiError('/api/compile', 503, 'unavailable'))).toBe(true)
        expect(server_test!(new ApiError('/api/compile', 429, 'quota_exceeded'))).toBe(false)
        expect(server_test!(new Error('other'))).toBe(false)

        // Storage: its own retries ran out, or the browser is offline; a refusal is final
        vi.stubGlobal('navigator', {...navigator, onLine: true})
        expect(upload_test!({code: 'storage/retry-limit-exceeded'})).toBe(true)
        expect(upload_test!({code: 'storage/unauthorized'})).toBe(false)
        vi.stubGlobal('navigator', {...navigator, onLine: false})
        expect(upload_test!({code: 'storage/unauthorized'})).toBe(true)
    })

    it('publishes the interior when its cover fails, and has the server finish the cover', async () => {
        // On a phone the book's compiler is let go before the cover's is started
        mocks.is_mobile.mockReturnValue(true)
        mocks.render_cover.mockRejectedValue(new Error('cover broke'))
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        await compile_and_upload(make_job(version))
        expect(generator.release_memory).toHaveBeenCalled()
        expect(stored('versions/v1')).toMatchObject({status: 'available', cover_status: 'pending'})
        expect(reported_stages()).toEqual(['cover_render'])
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', cover_only: true}]])
    })

    it('marks the cover failed when the server can\'t be asked to finish it', async () => {
        mocks.render_cover.mockRejectedValue(new Error('cover broke'))
        mocks.api.mockRejectedValue(new ApiError('/api/compile', 400, 'bad_cover_path'))
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        await compile_and_upload(make_job(version))
        expect(stored('versions/v1')).toMatchObject({status: 'available', cover_status: 'failed'})
        expect(reported_stages()).toEqual(['cover_render', 'cover_fallback'])
    })

    it('hands the version to the server when there\'s no compiler to use', async () => {
        mocks.generator.value = null
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', page_count: 40}]])
        expect(reported_stages()).toEqual(['wasm_compile'])
        // Nothing was compiled, so no attempt is logged
        expect(fake_db.added.get('compile_stats')).toBeUndefined()
        expect(stored('versions/v1')['status']).toBe('pending')
    })

    it('sends a device that ran out of memory to the server, settled by the outcome', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('out of memory'))
        mocks.device_failure.mockReturnValue(true)
        mocks.provisional.mockReturnValue(true)
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(fake_db.added.get('compile_stats')).toMatchObject([{ok: false, pages: null}])
        expect(mocks.switch_to_server).toHaveBeenCalledWith('memory')
        expect(api_calls()).toHaveLength(1)

        // Still compiling settles nothing; the server's outcome does, once
        fake_db.emit('versions/v1')
        expect(mocks.settle).not.toHaveBeenCalled()
        stored('versions/v1')['status'] = 'available'
        fake_db.emit('versions/v1')
        fake_db.emit('versions/v1')
        expect(mocks.settle.mock.calls).toEqual([[true]])
    })

    it('settles a provisional switch back when the server fails too', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('out of memory'))
        mocks.device_failure.mockReturnValue(true)
        mocks.provisional.mockReturnValue(true)
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        stored('versions/v1')['status'] = 'failed'
        fake_db.emit('versions/v1')
        expect(mocks.settle.mock.calls).toEqual([[false]])
    })

    it('settles nothing when the outcome never arrives or can\'t be listened for', async () => {
        vi.useFakeTimers()
        generator.compile_pdf.mockRejectedValue(new Error('out of memory'))
        mocks.provisional.mockReturnValue(true)
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(fake_db.listeners.get('versions/v1')).toHaveLength(1)
        // A compile that never reports back stops being listened for at STUCK_MS
        vi.advanceTimersByTime(STUCK_MS)
        expect(fake_db.listeners.get('versions/v1')).toHaveLength(0)

        // ...as does a listener that fails
        await compile_and_upload(make_job(version))
        fake_db.emit('versions/v1', new Error('permission denied'))
        expect(fake_db.listeners.get('versions/v1')).toHaveLength(0)
        expect(mocks.settle).not.toHaveBeenCalled()
    })

    it('stops quietly when another attempt published the version first', async () => {
        // This attempt's upload is refused because the other one's doc.pdf is already there
        mocks.upload.mockImplementation(async () => {
            stored('versions/v1')['status'] = 'available'
            throw Object.assign(new Error('refused'), {code: 'storage/unauthorized'})
        })
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(mocks.api).not.toHaveBeenCalled()
        expect(mocks.report_error).not.toHaveBeenCalled()
    })

    it('doesn\'t ask the server again when it says the version is no longer pending', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockRejectedValue(new ApiError('/api/compile', 409, 'not_pending'))
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(api_calls()).toHaveLength(1)
        expect(stored('versions/v1')['status']).toBe('pending')
        expect(reported_stages()).toEqual(['wasm_compile'])
    })

    it('records the failure, with a code to quote, when the server can\'t be reached', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockRejectedValue(new ApiOfflineError('/api/compile', new Error('offline')))
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(stored('versions/v1')).toMatchObject({status: 'failed', error_id: 'report_1'})
        expect(String(stored('versions/v1')['error'])).toContain('unreachable')
        expect(summary()['status']).toBe('failed')
    })

    it('still records the failure when the version can\'t be read first', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockRejectedValue(new ApiOfflineError('/api/compile', new Error('offline')))
        const version = make_version()
        seed(version)
        // The check after the browser's failure reads fine; the one before marking it failed
        // can't, which counts as "not settled", so the failure is still recorded
        const real_get = fake_db.failures
        mocks.api.mockImplementation(async () => {
            real_get.set('get:versions/v1', new Error('unavailable'))
            throw new ApiOfflineError('/api/compile', new Error('offline'))
        })
        await compile_and_upload(make_job(version))
        expect(stored('versions/v1')['status']).toBe('failed')
    })

    it('reports a failure it can\'t record, leaving the version to read as stuck', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockImplementation(async () => {
            fake_db.fail('update', 'versions/v1')
            throw new ApiError('/api/compile', 429, 'quota_exceeded')
        })
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(stored('versions/v1')['status']).toBe('pending')
        expect(reported_stages()).toEqual(['wasm_compile', 'compile_fallback',
            'compile_fallback_status'])
        // The summary still says what happened
        expect(summary()['status']).toBe('failed')
    })

    it('records nothing when the version was deleted meanwhile', async () => {
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockImplementation(async () => {
            fake_db.docs.delete('versions/v1')
            throw new ApiError('/api/compile', 404, 'not_found')
        })
        const version = make_version()
        seed(version)
        await compile_and_upload(make_job(version))
        expect(fake_db.docs.has('versions/v1')).toBe(false)
        expect(reported_stages()).toEqual(['wasm_compile'])
    })

    it('waits for its turn on the server, then gives up once it\'s waited long enough', async () => {
        vi.useFakeTimers()
        generator.compile_pdf.mockRejectedValue(new Error('broken'))
        mocks.api.mockRejectedValue(new ApiError('/api/compile', 409, 'compile_in_progress'))
        const version = make_version()
        seed(version)
        const done = compile_and_upload(make_job(version))
        await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
        await done
        // Asked every 10s for 3 minutes, then failed
        expect(api_calls().length).toBeGreaterThan(15)
        expect(stored('versions/v1')['status']).toBe('failed')
    })

    it('leaves a newer version\'s summary alone, and survives a summary that can\'t be written', async () => {
        const version = make_version()
        seed(version)
        // A newer version took over the summary meanwhile
        stored('designs/d1')['latest_version'] = {status: 'pending', save_token: 'newer'}
        await compile_and_upload(make_job(version))
        expect(stored('versions/v1')['status']).toBe('available')
        expect(summary()).toEqual({status: 'pending', save_token: 'newer'})

        // A transaction failing costs only the summary
        const second = make_version({id: 'v2'})
        seed(second)
        fake_db.fail('transaction', '*')
        await compile_and_upload(make_job(second))
        expect(stored('versions/v2')['status']).toBe('available')
        expect(reported_stages()).toEqual(['latest_version_summary'])
    })

})


describe('regenerate_version', () => {

    it('leaves a version alone while it\'s pending', async () => {
        seed(make_version())
        await regenerate_version(make_version())
        expect(fake_db.updates).toEqual([])
    })

    it('explains a withdrawn translation instead of rebuilding', async () => {
        const version = make_version({status: 'failed'})
        seed(version)
        set_translations([])
        await regenerate_version(version)
        expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining(version.blueprint.bibles[0]!))
        expect(fake_db.updates).toEqual([])
    })

    it('rebuilds an expired version with its real page count', async () => {
        const version = make_version({status: 'available', pages: 24, pdf_expires: new Date(0)})
        seed(version)
        build_requests['v1'] = {design_id: 'd1', clicked: 0}
        await regenerate_version(version)
        expect(build_requests).toEqual({})
        expect(stored('versions/v1')).toMatchObject({status: 'available', pages: 12})
        // The compile was sized by the version's own page count
        expect(fake_db.added.get('compile_stats')).toMatchObject([{estimated_pages: 24}])
    })

    it('sizes a never-compiled version by the open design\'s estimate, or the default', async () => {
        const version = make_version({status: 'failed'})
        seed(version)
        await regenerate_version(version)
        expect(fake_db.added.get('compile_stats')).toMatchObject([{estimated_pages: 300}])

        // Its own design open: the preview's estimate (the stub's page_count_guess gives 0)
        mocks.design_id.value = 'd1'
        stored('versions/v1')['status'] = 'failed'
        await regenerate_version(make_version({status: 'failed'}))
        expect(fake_db.added.get('compile_stats')![1]).toMatchObject({estimated_pages: 0})
    })

})


describe('regenerate_cover', () => {

    const published = (overrides:Partial<Version> = {}) => make_version({status: 'available',
        pages: 12, cover_status: 'failed', blueprint: make_blueprint({cover: COVER}), ...overrides})

    it('does nothing without a cover, or before the interior is published', async () => {
        await regenerate_cover(make_version({status: 'available'}))
        await regenerate_cover(published({status: 'failed'}))
        expect(mocks.render_cover).not.toHaveBeenCalled()
    })

    it('explains a withdrawn translation instead of rendering', async () => {
        set_translations([])
        await regenerate_cover(published())
        expect(mocks.alert).toHaveBeenCalled()
        expect(mocks.render_cover).not.toHaveBeenCalled()
    })

    it('renders the cover here when it can, without the server', async () => {
        const version = published({custom_fonts: [{family: 'Mine', style: 'serif', files: []}]})
        seed(version)
        await regenerate_cover(version)
        expect(stored('versions/v1')['cover_status']).toBe('available')
        // With the version's own snapshotted fonts
        expect(mocks.render_cover.mock.calls[0]![3]).toEqual([{family: 'Mine', files: []}])
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('leaves the cover to the server on a device that builds there', async () => {
        mocks.server_mode.mockReturnValue(true)
        const version = published()
        seed(version)
        await regenerate_cover(version)
        expect(mocks.render_cover).not.toHaveBeenCalled()
        expect(stored('versions/v1')['cover_status']).toBe('pending')
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', cover_only: true}]])
    })

    it('hands the cover to the server when it fails here', async () => {
        mocks.render_cover.mockRejectedValue(new Error('cover broke'))
        const version = published()
        seed(version)
        await regenerate_cover(version)
        expect(stored('versions/v1')['cover_status']).toBe('pending')
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', cover_only: true}]])
    })

    it('marks the cover failed when its outcome can\'t be recorded', async () => {
        const version = published({cover_status: 'available'})
        seed(version)
        fake_db.fail('update', 'versions/v1')
        await regenerate_cover(version)
        expect(stored('versions/v1')['cover_status']).toBe('failed')
        expect(reported_stages()).toEqual(['cover_regen'])
        expect(mocks.api).not.toHaveBeenCalled()
    })

})


describe('retry_version', () => {

    // The interior PDF a dead compile left in Storage, and the cover beside it if any
    const in_storage = (paths:string[]) => {
        mocks.download_url.mockImplementation(async ref => {
            if (!paths.includes(ref.path)){
                throw Object.assign(new Error('missing'), {code: 'storage/object-not-found'})
            }
            return `https://files/${ref.path}`
        })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
    }

    it('leaves alone a version that isn\'t pending, or that this tab is compiling', async () => {
        await retry_version(make_version({status: 'failed'}))
        version_progress['v1'] = {stage: 'start'}
        await retry_version(make_version())
        expect(mocks.download_url).not.toHaveBeenCalled()
    })

    it('adopts a PDF already uploaded, counting its pages, without the server', async () => {
        in_storage(['versions/v1/doc.pdf'])
        const version = make_version()
        seed(version)
        await retry_version(version)
        expect(generator.page_count).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
        expect(stored('versions/v1')).toMatchObject({status: 'available', pages: 8,
            cover_status: null})
        expect(summary()).toMatchObject({status: 'available', pages: 8})
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('adopts a cover uploaded beside it too', async () => {
        in_storage(['versions/v1/doc.pdf', 'versions/v1/cover.pdf'])
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        await retry_version(version)
        expect(stored('versions/v1')).toMatchObject({status: 'available', cover_status: 'available'})
        expect(mocks.render_cover).not.toHaveBeenCalled()
    })

    it('renders a missing cover, handing it to the server when that fails', async () => {
        in_storage(['versions/v1/doc.pdf'])
        mocks.render_cover.mockRejectedValue(new Error('cover broke'))
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        await retry_version(version)
        expect(stored('versions/v1')).toMatchObject({status: 'available', cover_status: 'pending'})
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', cover_only: true}]])
    })

    it('fails rather than guessing when Storage can\'t say whether a PDF is there', async () => {
        const version = make_version({blueprint: make_blueprint({cover: COVER})})
        seed(version)
        mocks.download_url.mockRejectedValue(Object.assign(new Error('?'), {code: 'storage/unknown'}))
        await expect(retry_version(version)).rejects.toThrow('?')

        // Likewise for the cover beside an interior that is there
        mocks.download_url.mockImplementation(async ref => {
            if (ref.path.endsWith('cover.pdf')){
                throw Object.assign(new Error('cover?'), {code: 'storage/unknown'})
            }
            return 'https://files/doc.pdf'
        })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))))
        await expect(retry_version(version)).rejects.toThrow('cover?')
        expect(stored('versions/v1')['status']).toBe('pending')
    })

    it('can\'t count an uploaded PDF\'s pages without a compiler', async () => {
        in_storage(['versions/v1/doc.pdf'])
        mocks.generator.value = null
        await expect(retry_version(make_version())).rejects.toThrow('Typst compiler not ready')
    })

    it('explains a withdrawn translation when there\'s nothing to adopt', async () => {
        in_storage([])
        set_translations([])
        const version = make_version()
        seed(version)
        await retry_version(version)
        expect(mocks.alert).toHaveBeenCalled()
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('hands the version to the server as a new attempt, recording a refusal', async () => {
        in_storage([])
        mocks.api.mockRejectedValue(new ApiError('/api/compile', 429, 'quota_exceeded'))
        const version = make_version()
        seed(version)
        build_requests['v1'] = {design_id: 'd1', clicked: 0}
        await retry_version(version)
        expect(build_requests).toEqual({})
        expect(fake_db.updates[0]).toEqual({path: 'versions/v1',
            fields: {error: null, compile_started: {server_timestamp: true}}})
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'v1', page_count: 300}]])
        expect(stored('versions/v1')).toMatchObject({status: 'failed', error_id: 'report_1'})
    })

})


describe('resume_abandoned_versions', () => {

    it('hands the server the user\'s own abandoned versions, each once per page load', async () => {
        const abandoned = make_version({id: 'r1'})
        seed(abandoned)
        resume_abandoned_versions([
            abandoned,
            // Not pending, someone else's, built in this tab, or already on the server
            make_version({id: 'r2', status: 'available'}),
            make_version({id: 'r3', owner: 'someone_else'}),
            make_version({id: 'r4', server_started: new Date()}),
        ])
        resume_abandoned_versions([abandoned])
        await vi.waitFor(() => expect(mocks.api).toHaveBeenCalled())
        expect(api_calls()).toEqual([['/api/compile', {version_id: 'r1', page_count: 300}]])
        expect(stored('versions/r1')['compile_started']).toEqual({server_timestamp: true})
    })

    it('skips one this tab is compiling or built, or whose translation was withdrawn', async () => {
        version_progress['r5'] = {stage: 'start'}
        build_requests['r6'] = {design_id: 'd1', clicked: 0}
        const versions = ['r5', 'r6', 'r7'].map(id => make_version({id}))
        set_translations([])
        resume_abandoned_versions(versions)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(mocks.api).not.toHaveBeenCalled()
    })

    it('is quiet about a version the server already has, and reports anything else', async () => {
        for (const id of ['r8', 'r9', 'r10']){
            seed(make_version({id}))
        }
        mocks.api.mockImplementation(async (_path, body) => {
            const id = (body as {version_id:string}).version_id
            throw id === 'r8' ? new ApiError('/api/compile', 409, 'not_pending')
                : id === 'r9' ? new ApiError('/api/compile', 409, 'compile_in_progress')
                : new ApiError('/api/compile', 500, 'internal')
        })
        resume_abandoned_versions(['r8', 'r9', 'r10'].map(id => make_version({id})))
        await vi.waitFor(() => expect(mocks.report_error).toHaveBeenCalled())
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(mocks.report_error.mock.calls.map(call =>
            (call[2] as {context:{version_id:string}}).context.version_id)).toEqual(['r10'])
    })

})
