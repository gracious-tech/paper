
// The HTTP surface, tested over the wire against a real server process.
//
// Everything else in this directory calls handlers directly. This file exists for the one thing
// that can only be seen from outside: authed_post(), the wrapper every authenticated route goes
// through. It does the token check and the body-field checks so a route can't be added without
// them, and forgetting either is a security hole rather than a visible bug. The other property
// checked here is role gating — SERVER_ROLES decides which routes exist at all, and CloudFront
// routes /api/compile to a different Lambda function, so the two have to agree.

import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

import {describe, it, expect, beforeAll, afterAll} from 'vitest'

import {reset_firestore, reset_auth, make_anon_user} from '../helpers/server.ts'

import type {ChildProcess} from 'node:child_process'


const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))


// Ports for the two role configurations, kept off the dev server's 8788
const LIGHT_PORT = 8791
const COMPILE_PORT = 8792


interface Server {
    process:ChildProcess
    url:string
}


async function start_server(roles:string, port:number):Promise<Server>{
    // Boot the real entry point with the test emulator env, and wait until it answers
    const child = spawn('node', ['server/src/dev_server.ts'], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            SERVER_ROLES: roles,
            PORT: String(port),
            // The compile role loads its assets tree lazily, so an unused path is fine here —
            // no test in this file reaches a real compile
            ASSETS_DIR: `${REPO_ROOT}assets`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const url = `http://127.0.0.1:${port}`

    // Poll the health endpoint rather than parsing startup output
    const deadline = Date.now() + 20_000
    for (;;){
        try {
            const response = await fetch(`${url}/api/health`)
            if (response.ok){
                return {process: child, url}
            }
        } catch {
            // Not listening yet
        }
        if (Date.now() > deadline){
            child.kill('SIGKILL')
            throw new Error(`Server (${roles}) did not start on :${port}`)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
    }
}


async function stop_server(server:Server):Promise<void>{
    // Shut a server process down and wait for it to actually exit
    server.process.kill('SIGKILL')
    await new Promise(resolve => server.process.once('exit', resolve))
}


let light:Server
let compile:Server
let token:string


beforeAll(async () => {
    await reset_firestore()
    await reset_auth()
    token = (await make_anon_user()).id_token
    ;[light, compile] = await Promise.all([
        start_server('light', LIGHT_PORT),
        start_server('compile', COMPILE_PORT),
    ])
}, 60_000)

afterAll(async () => {
    await Promise.all([stop_server(light), stop_server(compile)])
})


// POST a JSON body to a route, optionally with an Authorization header
async function post(server:Server, path:string, body:unknown,
        auth?:string):Promise<{status:number, body:unknown}>{
    const response = await fetch(`${server.url}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(auth === undefined ? {} : {Authorization: auth}),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return {status: response.status, body: await response.json().catch(() => null)}
}


// Every authenticated light route, with a body that would satisfy its field checks
const LIGHT_ROUTES:{path:string, body:Record<string, unknown>}[] = [
    {path: '/api/design_invite_preview', body: {design_id: 'd1', token: 't'}},
    {path: '/api/redeem_design_invite', body: {design_id: 'd1', token: 't'}},
    {path: '/api/design_editors', body: {design_id: 'd1'}},
    {path: '/api/copy_version', body: {version_id: 'v1'}},
    {path: '/api/touch_assets', body: {design_id: 'd1'}},
    {path: '/api/reconcile_design_assets', body: {design_id: 'd1'}},
    {path: '/api/delete_design', body: {design_id: 'd1'}},
    {path: '/api/delete_version', body: {version_id: 'v1'}},
    {path: '/api/duplicate_design', body: {design_id: 'd1'}},
    {path: '/api/delete_account', body: {}},
    {path: '/api/merge_account', body: {anon_token: 'x'}},
]


describe('health', () => {

    it('answers on both roles', async () => {
        for (const server of [light, compile]){
            const response = await fetch(`${server.url}/api/health`)
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ok: true})
        }
    })
})


describe('authentication', () => {

    for (const route of LIGHT_ROUTES){
        it(`refuses ${route.path} with no token`, async () => {
            const result = await post(light, route.path, route.body)
            expect(result.status).toBe(401)
            expect(result.body).toEqual({error: 'unauthenticated'})
        })
    }

    it('refuses /api/compile with no token', async () => {
        const result = await post(compile, '/api/compile', {version_id: 'v1'})
        expect(result.status).toBe(401)
    })

    it('refuses a token that is not a bearer token', async () => {
        const result = await post(light, '/api/design_editors', {design_id: 'd1'}, token)
        expect(result.status).toBe(401)
    })

    it('refuses a Basic authorization header', async () => {
        const result = await post(light, '/api/design_editors', {design_id: 'd1'},
            'Basic dXNlcjpwYXNz')
        expect(result.status).toBe(401)
    })

    it('refuses a bearer token that is not a valid ID token', async () => {
        const result = await post(light, '/api/design_editors', {design_id: 'd1'},
            'Bearer not-a-real-token')
        expect(result.status).toBe(401)
    })

    it('refuses a syntactically valid JWT signed by nobody', async () => {
        const forged = ['eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
            Buffer.from(JSON.stringify({sub: 'uid_attacker', aud: 'paper-bible-test'}))
                .toString('base64url'), ''].join('.')
        const result = await post(light, '/api/design_editors', {design_id: 'd1'},
            `Bearer ${forged}`)
        expect(result.status).toBe(401)
    })

    it('accepts a real ID token and reaches the handler', async () => {
        // The design doesn't exist, so the handler's own 404 is proof it was reached
        const result = await post(light, '/api/design_editors', {design_id: 'no_such_design'},
            `Bearer ${token}`)
        expect(result.status).toBe(404)
        expect(result.body).toEqual({error: 'not_found'})
    })
})


describe('body validation', () => {

    // Checked after the token, so an unauthenticated caller can't probe which fields a route
    // wants — every one of these is a 401 without a token (covered above)

    it('refuses a missing required field', async () => {
        const result = await post(light, '/api/design_editors', {}, `Bearer ${token}`)
        expect(result.status).toBe(400)
        expect(result.body).toEqual({error: 'bad_request'})
    })

    it('refuses a field of the wrong type', async () => {
        for (const design_id of [42, null, true, ['d1'], {id: 'd1'}]){
            const result = await post(light, '/api/design_editors', {design_id},
                `Bearer ${token}`)
            expect(result.status).toBe(400)
        }
    })

    it('refuses when only one of two required fields is present', async () => {
        const result = await post(light, '/api/redeem_design_invite', {design_id: 'd1'},
            `Bearer ${token}`)
        expect(result.status).toBe(400)
    })

    it('refuses a body that is not valid JSON', async () => {
        const result = await post(light, '/api/design_editors', 'not json',
            `Bearer ${token}`)
        expect(result.status).toBe(400)
    })

    it('refuses a JSON body that is not an object', async () => {
        for (const body of ['[]', '"str"', '42', 'null']){
            const result = await post(light, '/api/design_editors', body, `Bearer ${token}`)
            expect(result.status).toBe(400)
        }
    })

    it('ignores extra fields rather than refusing', async () => {
        const result = await post(light, '/api/design_editors',
            {design_id: 'no_such_design', extra: 'ignored'}, `Bearer ${token}`)
        expect(result.status).toBe(404)
    })

    it('accepts an empty body on the route that requires no fields', async () => {
        // /api/delete_account takes nothing — the token is both the authorisation and the
        // entire subject, so there is no way to aim it at anyone else. A throwaway account,
        // since a successful call retires the one that made it
        const doomed = await make_anon_user()
        const result = await post(light, '/api/delete_account', {}, `Bearer ${doomed.id_token}`)
        expect(result.status).toBe(200)
    })
})


describe('role gating', () => {

    // SERVER_ROLES decides which routes exist; CloudFront/API Gateway decide which Lambda
    // function gets the traffic. Both must agree or a route is reachable on the wrong function
    // size (or not at all)

    it('does not serve /api/compile on the light role', async () => {
        const result = await post(light, '/api/compile', {version_id: 'v1'}, `Bearer ${token}`)
        expect(result.status).toBe(404)
    })

    it('does not serve the light routes on the compile role', async () => {
        for (const route of LIGHT_ROUTES){
            const result = await post(compile, route.path, route.body, `Bearer ${token}`)
            expect(result.status).toBe(404)
        }
    })

    it('serves /api/compile on the compile role', async () => {
        // Reaching the handler at all is the point; a missing version is its own 404
        const result = await post(compile, '/api/compile', {}, `Bearer ${token}`)
        expect(result.status).toBe(400)
    })
})


describe('error reporting', () => {

    // Unauthenticated on purpose: errors can happen before or without sign-in

    it('accepts a report with no token', async () => {
        const result = await post(light, '/api/report_error',
            {message: 'Something broke', severity: 'error'})
        expect(result.status).toBe(200)
        expect((result.body as {id:string}).id).toMatch(/^[A-Za-z0-9\-_~]{20}$/)
    })

    it('stores a malformed report rather than rejecting it', async () => {
        // Triage needs to see that a client is sending bad data
        const result = await post(light, '/api/report_error', 'not json at all')
        expect(result.status).toBe(200)
    })

    it('honours a client-supplied id when it is well formed', async () => {
        const id = 'A'.repeat(20)
        const result = await post(light, '/api/report_error', {message: 'x', id})
        expect((result.body as {id:string}).id).toBe(id)
    })

    it('replaces a malformed client-supplied id', async () => {
        const result = await post(light, '/api/report_error', {message: 'x', id: 'short'})
        expect((result.body as {id:string}).id).not.toBe('short')
    })

    it('throttles a flood from one caller', async () => {
        // Per-IP and best-effort per instance, but enough to stop a stuck client filling the
        // bucket. Every request here shares one source address
        const results:number[] = []
        for (let i = 0; i < 15; i++){
            const response = await fetch(`${light.url}/api/report_error`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json',
                    'x-forwarded-for': '203.0.113.9'},
                body: JSON.stringify({message: `flood ${i}`}),
            })
            results.push(response.status)
        }
        expect(results).toContain(429)
        expect(results.filter(status => status === 200).length).toBeLessThanOrEqual(10)
    })

    it('throttles per IP, so one flooder does not block everyone', async () => {
        const response = await fetch(`${light.url}/api/report_error`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json',
                'x-forwarded-for': '198.51.100.4'},
            body: JSON.stringify({message: 'from a different address'}),
        })
        expect(response.status).toBe(200)
    })
})


describe('unknown routes', () => {

    it('404s anything not declared', async () => {
        for (const server of [light, compile]){
            const result = await post(server, '/api/nope', {}, `Bearer ${token}`)
            expect(result.status).toBe(404)
        }
    })

    it('404s a GET of a POST-only route', async () => {
        const response = await fetch(`${light.url}/api/design_editors`)
        expect(response.status).toBe(404)
    })
})
