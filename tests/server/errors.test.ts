// Taking in error reports. A report is stored whatever shape it arrives in, since a client
// sending bad data is itself worth triaging, so what's under test is how each field is trimmed
// or dropped on the way into the bucket, the per-IP throttle, and that saving never throws.
// The route around it (no token needed, the IP taken from x-forwarded-for) is routes.test.ts'

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {handle_report_error, report_allowed, save_error} from '../../server/src/errors.ts'
import {admin_bucket, reset_storage, list_paths} from '../helpers/server.ts'

import type {ErrorRecord} from '../../server/src/errors.ts'


beforeEach(async () => {
    await reset_storage()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})


// Store a report from a raw body, and read back what landed in the bucket
async function stored(raw:string):Promise<ErrorRecord>{
    const result = await handle_report_error(raw, '203.0.113.1', null, 'Test UA')
    const id = (result.body as {id:string}).id
    const path = (await list_paths('errors/')).find(name => name.endsWith(`/${id}.json`))
    const [contents] = await admin_bucket.file(path ?? '').download()
    return JSON.parse(contents.toString()) as ErrorRecord
}


describe('handle_report_error', () => {

    it('stores a well-formed report as it came, with the caller\'s details', async () => {
        const record = await stored(JSON.stringify({message: 'It broke', severity: 'critical',
            url: 'https://paper.bible/designs', language: 'pt-BR', runtime_ms: 1234,
            context: {version_id: 'v1', attempt: 2}}))
        expect(record).toMatchObject({source: 'browser', severity: 'critical',
            message: 'It broke', ip: '203.0.113.1', user_agent: 'Test UA', language: 'pt-BR',
            url: 'https://paper.bible/designs', runtime_ms: 1234,
            context: {version_id: 'v1', attempt: 2}})
        expect(record.fingerprint).toMatch(/^[0-9a-f]{12}$/)
    })

    it('flags an oversized body as truncated, and still stores what it could read', async () => {
        const record = await stored(JSON.stringify({message: 'x'.repeat(70_000)}))
        // Cut mid-JSON, so it no longer parses: kept as raw text, both flags set
        expect(record.context).toEqual({truncated: 'true', malformed: 'true'})
        expect(record.message.startsWith('[malformed report] {"message":"xxx')).toBe(true)
    })

    it('keeps only plain string and number context, and at most 20 entries', async () => {
        const context:Record<string, unknown> = {nested: {a: 1}, flag: true, none: null}
        for (let i = 0; i < 30; i++){
            context[`key_${i}`] = i
        }
        const record = await stored(JSON.stringify({message: 'x', context}))
        expect(Object.keys(record.context ?? {})).toHaveLength(20)
        expect(record.context).not.toHaveProperty('nested')
        expect(record.context).not.toHaveProperty('flag')
    })

    it('drops a field of the wrong type or shape rather than refusing the report', async () => {
        const record = await stored(JSON.stringify({message: 'x', severity: 'catastrophic',
            url: 42, language: ['en'], runtime_ms: '12', context: 'not an object'}))
        expect(record).toMatchObject({severity: 'error', url: null, language: null,
            runtime_ms: null, context: null})
    })

    it('caps the free-text fields a client controls', async () => {
        const record = await stored(JSON.stringify({message: 'x', url: 'u'.repeat(5000),
            language: 'l'.repeat(500)}))
        expect(record.url).toHaveLength(1000)
        expect(record.language).toHaveLength(50)
    })

    it('gives messages differing only in ids and numbers one fingerprint', async () => {
        const first = await stored(JSON.stringify(
            {message: 'Version AbCdEfGhIjKlMnOpQr failed after 3 tries at https://a.test/x'}))
        const second = await stored(JSON.stringify(
            {message: 'Version ZyXwVuTsRqPoNmLkJi failed after 12 tries at https://b.test/y'}))
        const other = await stored(JSON.stringify({message: 'Something else entirely'}))
        expect(first.fingerprint).toBe(second.fingerprint)
        expect(other.fingerprint).not.toBe(first.fingerprint)
    })
})


describe('save_error', () => {

    it('never throws, even when the bucket refuses the write', async () => {
        vi.spyOn(admin_bucket, 'file').mockImplementation(() => {
            throw new Error('bucket unreachable')
        })
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const id = await save_error({id: 'A'.repeat(20), source: 'server', severity: 'error',
            message: 'x', ip: null, uid: null, url: null, user_agent: null, language: null,
            runtime_ms: null, context: null})
        expect(id).toBe('A'.repeat(20))
    })
})


describe('report_allowed', () => {

    it('lets an address through ten times per window, then again once it has passed', () => {
        const ip = '198.51.100.20'
        const results = Array.from({length: 12}, () => report_allowed(ip))
        expect(results.filter(Boolean)).toHaveLength(10)
        expect(results.at(-1)).toBe(false)

        // Eleven minutes on, the window has rolled over
        vi.useFakeTimers({toFake: ['Date'], now: Date.now() + 11 * 60 * 1000})
        expect(report_allowed(ip)).toBe(true)
    })

    it('forgets every address once it tracks over a thousand, rather than growing forever', () => {
        const ip = '198.51.100.21'
        for (let i = 0; i < 11; i++){
            report_allowed(ip)
        }
        expect(report_allowed(ip)).toBe(false)

        // A thousand other callers, each starting a window of its own; the next new one resets
        for (let i = 0; i < 1001; i++){
            report_allowed(`10.0.${Math.floor(i / 256)}.${i % 256}`)
        }
        report_allowed('192.0.2.200')
        expect(report_allowed(ip)).toBe(true)
    })
})


describe('errors outside any request', () => {

    // Call what index.ts registers on the process directly: emitting the events for real would
    // reach the test runner's own listeners too, which fail the run on any unhandled error
    async function process_handlers():Promise<Record<string, (error:unknown) => void>>{
        const events = ['unhandledRejection', 'uncaughtException'] as const
        const before = new Map(events.map(event => [event, new Set(process.listeners(event))]))
        await import('../../server/src/index.ts')
        return Object.fromEntries(events.map(event => {
            const added = process.listeners(event).filter(listener =>
                !before.get(event)!.has(listener))
            expect(added).toHaveLength(1)
            // Taken off again so nothing outlives this suite
            process.removeListener(event, added[0]!)
            return [event, added[0] as unknown as (error:unknown) => void]
        }))
    }

    // The one report in the bucket, once its fire-and-forget write has landed
    async function only_report():Promise<ErrorRecord>{
        await expect.poll(() => list_paths('errors/')).toHaveLength(1)
        const [path] = await list_paths('errors/')
        return JSON.parse((await admin_bucket.file(path!).download())[0].toString()) as ErrorRecord
    }

    it('are kept as critical server reports, named by how they escaped', async () => {
        const handlers = await process_handlers()
        vi.spyOn(console, 'error').mockImplementation(() => {})

        handlers['unhandledRejection']!(new Error('a promise nobody awaited'))
        const rejection = await only_report()
        expect(rejection).toMatchObject({source: 'server', severity: 'critical', uid: null,
            url: null})
        expect(rejection.message).toMatch(/^unhandledRejection: Error: a promise nobody awaited\n/)

        // Something thrown that isn't an Error is kept as its text
        await reset_storage()
        handlers['uncaughtException']!('a bare string')
        expect((await only_report()).message).toBe('uncaughtException: a bare string')
    })
})
