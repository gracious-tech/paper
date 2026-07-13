
import {Hono} from 'hono'
import {serve} from '@hono/node-server'

import {Readable} from 'node:stream'

import {config} from './config.ts'
import {verify_uid} from './auth.ts'
import {save_error, generate_error_id, get_client_ip, report_allowed,
    handle_report_error} from './errors.ts'
import {handle_compile} from './compile.ts'
import {handle_redeem_draft, get_shared_creation, get_shared_creation_pdf,
    handle_copy_creation} from './share.ts'
import {handle_merge} from './merge.ts'


// The API server — reached via Firebase Hosting's /api/** rewrite in production and Vite's
// dev proxy locally, so all routes are same-origin for the app (no CORS needed)
// In production this codebase is deployed as two Cloud Run services (see .bin/deploy_server):
// Hosting routes /api/compile to the 'compile' service and everything else to 'light'
const app = new Hono()


// Health check (also used by Cloud Run startup probes)
app.get('/api/health', context => {
    return context.json({ok: true})
})


// Compile a pending creation server-side (in-browser compile fallback + regeneration)
// Only served by the 'compile' role — the one route needing typst, fonts, and Bible fetching
if (config.roles.includes('compile')){
    app.post('/api/compile', async context => {
        const uid = await verify_uid(context.req.header('Authorization'))
        if (!uid){
            return context.json({error: 'unauthenticated'}, 401)
        }
        const body = await context.req.json().catch(() => null) as {creation_id?:unknown}|null
        if (typeof body?.creation_id !== 'string'){
            return context.json({error: 'bad_request'}, 400)
        }
        const result = await handle_compile(uid, body.creation_id, get_client_ip(context))
        return context.json(result.body, result.status as 200)
    })
}


// The remaining routes need only the Admin SDK and are served by the 'light' role
if (config.roles.includes('light')){

    // Receive an error report from the browser and store it in the bucket — no auth required
    // (errors can occur before/without sign-in) but the uid is recorded when a token is present.
    // Only the rate limit actually refuses the request; handle_report_error itself never fails
    app.post('/api/report_error', async context => {
        const ip = get_client_ip(context)
        if (!report_allowed(ip)){
            return context.json({error: 'too_many_reports'}, 429)
        }
        const raw = await context.req.text().catch(() => '')
        const uid = await verify_uid(context.req.header('Authorization'))
        const result = await handle_report_error(
            raw, ip, uid, context.req.header('User-Agent') ?? null)
        return context.json(result.body, result.status as 200)
    })

    // Redeem a draft share link (adds the caller as an editor)
    app.post('/api/redeem_draft', async context => {
        const uid = await verify_uid(context.req.header('Authorization'))
        if (!uid){
            return context.json({error: 'unauthenticated'}, 401)
        }
        const body = await context.req.json().catch(() => null) as
            {draft_id?:unknown, token?:unknown}|null
        if (typeof body?.draft_id !== 'string' || typeof body?.token !== 'string'){
            return context.json({error: 'bad_request'}, 400)
        }
        const result = await handle_redeem_draft(uid, body.draft_id, body.token)
        return context.json(result.body, result.status as 200)
    })

    // Shared creation metadata + PDF — the secret token is the capability, so no auth required
    // (recipients open these from a bare link, possibly before ever visiting the app)
    app.get('/api/shared_creation/:id/:token', async context => {
        const result = await get_shared_creation(
            context.req.param('id'), context.req.param('token'))
        return context.json(result.body, result.status as 200)
    })

    app.get('/api/shared_creation/:id/:token/pdf', async context => {
        const result = await get_shared_creation_pdf(
            context.req.param('id'), context.req.param('token'))
        if (result instanceof Readable){
            context.header('Content-Type', 'application/pdf')
            return context.body(Readable.toWeb(result) as ReadableStream)
        }
        return context.json(result.body, result.status as 200)
    })

    // "Keep own copy" of a shared creation
    app.post('/api/copy_creation', async context => {
        const uid = await verify_uid(context.req.header('Authorization'))
        if (!uid){
            return context.json({error: 'unauthenticated'}, 401)
        }
        const body = await context.req.json().catch(() => null) as
            {creation_id?:unknown, token?:unknown}|null
        if (typeof body?.creation_id !== 'string' || typeof body?.token !== 'string'){
            return context.json({error: 'bad_request'}, 400)
        }
        const result = await handle_copy_creation(uid, body.creation_id, body.token)
        return context.json(result.body, result.status as 200)
    })

    // Merge a guest account's data into the (already signed-in) existing account
    app.post('/api/merge_account', async context => {
        const uid = await verify_uid(context.req.header('Authorization'))
        if (!uid){
            return context.json({error: 'unauthenticated'}, 401)
        }
        const body = await context.req.json().catch(() => null) as {anon_token?:unknown}|null
        if (typeof body?.anon_token !== 'string'){
            return context.json({error: 'bad_request'}, 400)
        }
        const result = await handle_merge(uid, body.anon_token)
        return context.json(result.body, result.status as 200)
    })

}


// Save any uncaught route error to the bucket (recursion-safe — save_error never throws)
app.onError((error, context) => {
    console.error(error)
    void save_error({
        id: generate_error_id(),
        source: 'server',
        severity: 'error',
        message: error.stack ?? String(error),
        ip: get_client_ip(context),
        uid: null,
        url: context.req.path,
        user_agent: context.req.header('User-Agent') ?? null,
        language: null,
        runtime_ms: null,
        context: null,
    })
    return context.json({error: 'internal'}, 500)
})


// Last-resort capture of errors outside any request handler
function save_process_error(kind:string, error:unknown):void{
    // Log and save a process-level failure (fire-and-forget)
    console.error(error)
    void save_error({
        id: generate_error_id(),
        source: 'server',
        severity: 'critical',
        message: `${kind}: ${
            error instanceof Error ? error.stack ?? error.message : String(error)}`,
        ip: null,
        uid: null,
        url: null,
        user_agent: null,
        language: null,
        runtime_ms: null,
        context: null,
    })
}
process.on('unhandledRejection', reason => {
    save_process_error('unhandledRejection', reason)
})
process.on('uncaughtException', error => {
    save_process_error('uncaughtException', error)
    // Give the bucket write a moment to flush, then die so Cloud Run replaces the instance
    setTimeout(() => {
        process.exit(1)
    }, 2000)
})


// Start listening
serve({fetch: app.fetch, port: config.port}, info => {
    console.log(`paper-bible-server (${config.roles.join('+')}) listening on :${info.port}`)
})
