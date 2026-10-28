
// The read side of versions (versions.ts) where the journeys don't go: the list sync's first
// snapshot and failures, waiting for a version to settle, a pending cover reading as stuck once
// time passes, the pending clock with nothing to time, PDF links that can't be had, and sharing a
// link where the share sheet or clipboard is missing or refuses. Firestore is an in-memory fake
// (see helpers/fake_firestore.ts); Storage and the API are stand-ins

import {effectScope} from 'vue'
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {fake_db, module as fake_firestore} from './helpers/fake_firestore'
import {make_blueprint} from './helpers/blueprint'
import {build_requests} from '@/services/compile_progress'
import {versions, start_versions_sync, stop_versions_sync, until_version_settled, cover_pending,
    use_pending_clock, get_pdf_url, get_cover_pdf_url, open_version_pdf, download_version_pdf,
    fetch_shared_version, share_version, STUCK_MS} from '@/services/versions'

import type {Blueprint, Version} from '@/services/types'


// The collaborators each test drives
const mocks = vi.hoisted(() => ({
    download_url: vi.fn(async (ref:{path:string}):Promise<string> => `https://files/${ref.path}`),
    report_error: vi.fn((..._args:unknown[]) => 'report_1'),
}))

vi.mock('firebase/firestore', async () => (await import('./helpers/fake_firestore')).module)
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => ({path}),
    getDownloadURL: mocks.download_url,
}))
vi.mock('@/services/firebase', () => ({firestore: {}, firebase_storage: {}, firebase_auth: {}}))
vi.mock('@/services/api', () => ({api: vi.fn()}))
vi.mock('@/services/auth', () => ({user: {value: {uid: 'me'}}}))
vi.mock('@/services/designs', () => ({designs: [], current_design_id: {value: null},
    until_listed: async () => undefined}))
vi.mock('@/services/errors', () => ({report_error: mocks.report_error}))
// (The real module reaches the compiler, which listens for page events at import)
vi.mock('@/services/new_design', () => ({
    read_wizard_state: () => ({wizard_draft: null, simple_mode: false}),
}))


// A cover config — its contents never matter here
const COVER = {form: {}} as unknown as NonNullable<Blueprint['cover']>


// A version as the list holds it
function make_version(overrides:Partial<Version> = {}):Version {
    return {
        id: 'v1', design_id: 'd1', owner: 'me', created: new Date(), compile_started: null,
        server_started: null, title: 'My Bible', blueprint: make_blueprint(), status: 'available',
        cover_status: null, cover_render_version: null, pages: 12,
        pdf_path: 'versions/v1/doc.pdf', pdf_expires: null, copied_from: null, custom_fonts: [],
        save_token: 'tok', error: null, error_id: null, wizard_draft: null, simple_mode: false,
        ...overrides,
    }
}


// A version doc as Firestore stores it
function version_doc(fields:Record<string, unknown> = {}):Record<string, unknown> {
    return {design_id: 'd1', owner: 'me', title: 'My Bible', status: 'available',
        created: fake_firestore.Timestamp.fromMillis(1000), blueprint: make_blueprint(),
        pdf_path: 'versions/x/doc.pdf', save_token: 'tok', schema: 1, ...fields}
}


// A Storage error with its code
const storage_error = (code:string) => Object.assign(new Error(code), {code})


beforeEach(() => {
    fake_db.reset()
    vi.clearAllMocks()
    mocks.download_url.mockImplementation(async ref => `https://files/${ref.path}`)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    stop_versions_sync()
})


describe('a cover the server never finished', () => {

    // First in the file, so the module's coarse clock starts under fake timers
    it('stops reading as pending once it has sat past STUCK_MS', () => {
        vi.useFakeTimers()
        const version = make_version({cover_status: 'pending', compile_started: new Date()})
        expect(cover_pending(version)).toBe(true)
        vi.advanceTimersByTime(STUCK_MS + 5000)
        expect(cover_pending(version)).toBe(false)
    })

})


describe('the list sync', () => {

    it('hands over the list as the design opened with, then just keeps it current', () => {
        fake_db.docs.set('versions/a', version_doc({status: 'pending'}))
        const on_loaded = vi.fn()
        start_versions_sync('d1', on_loaded)
        fake_db.emit_query('versions')
        expect(on_loaded.mock.calls.map(([loaded]) =>
            (loaded as Version[]).map(item => [item.id, item.status]))).toEqual([[['a', 'pending']]])

        fake_db.docs.set('versions/b', version_doc())
        fake_db.emit_query('versions')
        expect(versions.map(item => item.id)).toEqual(['a', 'b'])
        expect(on_loaded).toHaveBeenCalledTimes(1)
    })

    it('reports a failed listener quietly, and lets go of the list when stopped', () => {
        start_versions_sync('d1')
        fake_db.listeners.get('versions')![0]!.error!(new Error('permission denied'))
        expect(mocks.report_error.mock.calls[0]![2]).toEqual({context: {listener: 'version_list'}})

        fake_db.docs.set('versions/a', version_doc())
        fake_db.emit_query('versions')
        stop_versions_sync()
        expect(versions).toEqual([])
        expect(fake_db.listeners.get('versions')).toEqual([])
    })

})


describe('until_version_settled', () => {

    it('resolves with the status the version leaves pending for', async () => {
        fake_db.docs.set('versions/v1', {status: 'pending'})
        const settled = until_version_settled('v1')
        fake_db.emit('versions/v1')
        fake_db.docs.set('versions/v1', {status: 'failed'})
        fake_db.emit('versions/v1')
        expect(await settled).toBe('failed')
        expect(fake_db.listeners.get('versions/v1')).toEqual([])
    })

    it('resolves null for a version that\'s gone or can\'t be read', async () => {
        const gone = until_version_settled('v1')
        fake_db.emit('versions/v1')
        expect(await gone).toBe(null)

        const unreadable = until_version_settled('v2')
        fake_db.emit('versions/v2', new Error('permission denied'))
        expect(await unreadable).toBe(null)
    })

    it('gives up as still pending once a compile could no longer be running', async () => {
        vi.useFakeTimers()
        fake_db.docs.set('versions/v1', {status: 'pending'})
        const settled = until_version_settled('v1')
        vi.advanceTimersByTime(STUCK_MS)
        expect(await settled).toBe('pending')
        expect(fake_db.listeners.get('versions/v1')).toEqual([])
    })

})


describe('use_pending_clock', () => {

    it('reads blank with nothing waiting, and times a build from its click', () => {
        const scope = effectScope()
        const idle = scope.run(() => use_pending_clock(() => null))!
        expect(idle.elapsed.value).toBe('')
        expect(idle.stuck.value).toBe(false)

        vi.useFakeTimers()
        build_requests['v1'] = {design_id: 'd1', clicked: Date.now() - 65_000}
        const pending = scope.run(() => use_pending_clock(() => make_version({status: 'pending'})))!
        expect(pending.elapsed.value).toBe('1:05')
        delete build_requests['v1']
        scope.stop()
    })

})


describe('PDF links', () => {

    it('has none for a version that isn\'t available or has expired', async () => {
        expect(await get_pdf_url(make_version({status: 'pending'}))).toBe(null)
        expect(await get_pdf_url(make_version({pdf_expires: new Date(0)}))).toBe(null)
        expect(mocks.download_url).not.toHaveBeenCalled()
    })

    it('degrades a missing or unreachable PDF to none, reporting only the unexpected', async () => {
        mocks.download_url.mockRejectedValueOnce(storage_error('storage/object-not-found'))
        expect(await get_pdf_url(make_version())).toBe(null)
        expect(mocks.report_error).not.toHaveBeenCalled()

        mocks.download_url.mockRejectedValueOnce(storage_error('storage/unknown'))
        expect(await get_pdf_url(make_version())).toBe(null)
        expect(mocks.report_error.mock.calls[0]![2]).toEqual(
            {context: {version_id: 'v1', stage: 'get_pdf_url'}})
    })

    it('finds a cover by the version\'s id, unless there\'s none to show', async () => {
        const with_cover = (overrides:Partial<Version> = {}) =>
            make_version({blueprint: make_blueprint({cover: COVER}), ...overrides})
        expect(await get_cover_pdf_url(make_version())).toBe(null)
        expect(await get_cover_pdf_url(with_cover({cover_status: 'failed'}))).toBe(null)
        expect(await get_cover_pdf_url(with_cover({cover_status: 'pending'}))).toBe(null)
        expect(await get_cover_pdf_url(with_cover({status: 'failed'}))).toBe(null)
        expect(await get_cover_pdf_url(with_cover({pdf_expires: new Date(0)}))).toBe(null)
        expect(await get_cover_pdf_url(with_cover({cover_status: 'available'})))
            .toBe('https://files/versions/v1/cover.pdf')

        // A missing cover is expected; anything else is reported
        mocks.download_url.mockRejectedValueOnce(storage_error('storage/object-not-found'))
        expect(await get_cover_pdf_url(with_cover())).toBe(null)
        mocks.download_url.mockRejectedValueOnce(storage_error('storage/unknown'))
        expect(await get_cover_pdf_url(with_cover())).toBe(null)
        expect(mocks.report_error).toHaveBeenCalledTimes(1)
    })

    it('points the opened tab at the PDF, or closes it when there\'s none', async () => {
        const tab = {location: {href: ''}, close: vi.fn()}
        await open_version_pdf(tab as unknown as Window, make_version(), 'interior')
        expect(tab.location.href).toBe('https://files/versions/v1/doc.pdf')
        await open_version_pdf(tab as unknown as Window, make_version(), 'cover')
        expect(tab.close).toHaveBeenCalled()
    })

    it('downloads under a filename made safe from the title, and nothing when there\'s no PDF', async () => {
        const fetch_mock = vi.fn(async () => new Response('pdf'))
        vi.stubGlobal('fetch', fetch_mock)
        await download_version_pdf(make_version({status: 'pending'}), 'interior')
        expect(fetch_mock).not.toHaveBeenCalled()

        const anchor = {href: '', download: '', click: vi.fn(), remove: vi.fn()}
        vi.stubGlobal('document', {createElement: () => anchor, body: {appendChild: vi.fn()}})
        vi.useFakeTimers()
        await download_version_pdf(make_version({title: 'Ruth: a/b?',
            blueprint: make_blueprint({cover: COVER}), cover_status: 'available'}), 'cover')
        expect(anchor.download).toBe('Ruth- a-b- (cover).pdf')
        expect(anchor.click).toHaveBeenCalled()
        await download_version_pdf(make_version({title: '  '}), 'interior')
        expect(anchor.download).toBe('bible.pdf')
    })

})


describe('fetch_shared_version', () => {

    it('reads a shared version by id alone, and refuses one that doesn\'t exist', async () => {
        fake_db.docs.set('versions/v1', version_doc({title: 'Shared'}))
        expect(await fetch_shared_version('v1')).toMatchObject({id: 'v1', title: 'Shared'})
        await expect(fetch_shared_version('nope')).rejects.toThrow('not_found')
    })

})


describe('share_version', () => {

    beforeEach(() => {
        vi.stubGlobal('location', {origin: 'https://paper.bible'})
    })

    // A navigator with only what's given
    const browser = (extra:Record<string, unknown>) => vi.stubGlobal('navigator', extra)

    it('uses the share sheet, cancelling it included', async () => {
        const share = vi.fn(async () => undefined)
        browser({share})
        expect(await share_version('d1', 'v1')).toBe('shared')
        expect(share).toHaveBeenCalledWith({url: 'https://paper.bible/designs/d1/v1'})

        share.mockRejectedValueOnce(Object.assign(new Error('cancelled'), {name: 'AbortError'}))
        expect(await share_version('d1', 'v1')).toBe('shared')
    })

    it('falls back to the clipboard when the share sheet fails', async () => {
        const writeText = vi.fn(async () => undefined)
        browser({share: vi.fn(async () => {
            throw new Error('not allowed')
        }), clipboard: {writeText}})
        expect(await share_version('d1', 'v1')).toBe('copied')
        expect(writeText).toHaveBeenCalledWith('https://paper.bible/designs/d1/v1')
    })

    it('leaves it to the user when neither works or exists', async () => {
        browser({clipboard: {writeText: vi.fn(async () => {
            throw new Error('denied')
        })}})
        expect(await share_version('d1', 'v1')).toBe('manual')
        browser({})
        expect(await share_version('d1', 'v1')).toBe('manual')
    })

})
