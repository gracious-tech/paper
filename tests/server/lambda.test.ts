
// The production entry point (server/src/lambda.ts): one image backs both Lambda functions, and
// SERVER_ROLES decides which handler it exports. Get that wrong and the light function would
// treat API Gateway events as compile jobs, or the compile function would answer HTTP — neither
// of which the dev server (dev_server.ts, what every other suite reaches) can show.
//
// Each test imports the module fresh under its own SERVER_ROLES, since config reads it once

import {describe, it, expect, afterEach, vi} from 'vitest'

import type {CompileJob} from '../../server/src/compile.ts'
import type {PreviewJob} from '../../server/src/preview.ts'


// The compile and its asset sync, which the compile handler only has to wire together (each has
// its own suite: run_compile.test.ts, lambda_bootstrap.test.ts)
vi.mock('../../server/src/compile.ts', async original => ({
    ...await original<typeof import('../../server/src/compile.ts')>(),
    run_compile: vi.fn(),
}))
vi.mock('../../server/src/preview.ts', async original => ({
    ...await original<typeof import('../../server/src/preview.ts')>(),
    run_preview: vi.fn(),
}))
vi.mock('../../server/src/lambda_bootstrap.ts', () => ({
    ensure_assets_synced: vi.fn(),
}))


// A fresh lambda.ts under the given roles, with the mocks it was wired to
async function load(roles:string){
    vi.resetModules()
    process.env['SERVER_ROLES'] = roles
    const {handler} = await import('../../server/src/lambda.ts')
    const {run_compile} = await import('../../server/src/compile.ts')
    const {run_preview} = await import('../../server/src/preview.ts')
    const {ensure_assets_synced} = await import('../../server/src/lambda_bootstrap.ts')
    return {handler: handler as (event:unknown) => Promise<unknown>,
        run_compile: vi.mocked(run_compile), run_preview: vi.mocked(run_preview),
        ensure_assets_synced}
}


// An API Gateway HTTP API (payload 2.0) event, as CloudFront's /api/* origin delivers it
function http_event(method:string, path:string, body?:unknown):Record<string, unknown>{
    return {
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers: {'host': 'paper.bible', 'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.9'},
        requestContext: {
            http: {method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.9',
                userAgent: 'test-agent'},
            domainName: 'paper.bible',
            requestId: 'request_id',
            stage: '$default',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        isBase64Encoded: false,
    }
}


afterEach(() => {
    delete process.env['SERVER_ROLES']
})


describe('the compile function', () => {

    it('takes a compile job, and syncs its assets inside the compile', async () => {
        const {handler, run_compile, ensure_assets_synced} = await load('compile')
        const job:CompileJob = {uid: 'uid_owner', version_id: 'version_id', client_ip: null,
            user_agent: null}

        await handler(job)

        // The sync is handed to the compile rather than run first, so a sync that fails marks
        // the version failed instead of leaving it pending (see run_compile)
        expect(run_compile).toHaveBeenCalledExactlyOnceWith(job, ensure_assets_synced)
        expect(ensure_assets_synced).not.toHaveBeenCalled()
    })

    it('tells a preview job apart by its kind', async () => {
        const {handler, run_compile, run_preview, ensure_assets_synced} = await load('compile')
        const job:PreviewJob = {kind: 'preview', uid: 'uid_owner', preview_id: 'preview_id',
            design_id: 'design_id', client_ip: null, user_agent: null, size: 'phone',
            section: 'start'}

        await handler(job)

        expect(run_preview).toHaveBeenCalledExactlyOnceWith(job, ensure_assets_synced)
        expect(run_compile).not.toHaveBeenCalled()
    })
})


describe('the light function', () => {

    it('answers API Gateway events with the app', async () => {
        const {handler, run_compile} = await load('light')

        const response = await handler(http_event('GET', '/api/health')) as
            {statusCode:number, body:string}
        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ok: true})
        expect(run_compile).not.toHaveBeenCalled()
    })

    it('serves the authed routes, refusing a call with no token', async () => {
        const {handler} = await load('light')

        const response = await handler(http_event('POST', '/api/compile',
            {version_id: 'version_id'})) as {statusCode:number}
        expect(response.statusCode).toBe(401)
    })
})
