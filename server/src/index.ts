
import {Hono} from 'hono'

import {config} from './config.ts'
import {verify_uid} from './auth.ts'
import {save_error, generate_error_id, get_client_ip, report_allowed,
    handle_report_error} from './errors.ts'
import {handle_compile} from './compile.ts'
import {handle_design_invite_preview, handle_redeem_design_invite, handle_design_editors,
    handle_copy_version} from './share.ts'
import {handle_merge} from './merge.ts'
import {handle_touch_assets, handle_reconcile_assets} from './assets.ts'
import {handle_delete_design, handle_delete_version, handle_duplicate_design}
    from './designs.ts'
import {handle_delete_account} from './account.ts'

import type {Context} from 'hono'
import type {HandlerResult} from './types.ts'


// The API server — reached via CloudFront's /api/** cache behavior in production and Vite's
// dev proxy locally, so all routes are same-origin for the app (no CORS needed)
// In production this codebase is deployed as two Lambda functions sharing one image (see
// infra/cloudformation.yml): API Gateway routes /api/compile to the 'compile' function and
// everything else to 'light'. This module only builds the app — server/src/dev_server.ts
// serves it locally via a real listener, server/src/lambda.ts wraps it for Lambda
export const app = new Hono()


// The raw request, given to the rare handler that needs more than its required string fields:
// an optional value from the body, or the caller's IP / user agent
interface RouteRequest {
    context:Context
    body:Record<string, unknown>
}


function authed_post<const F extends readonly string[]>(path:string, fields:F,
        handler:(uid:string, args:Record<F[number], string>, request:RouteRequest)
            => Promise<HandlerResult>):void{
    // Register a POST route that requires a valid ID token and the named string fields in its
    // JSON body, refusing with 401/400 before the handler is ever reached.
    //
    // Every authed route needs the same three steps first — verify the token, parse the body,
    // check each field really is a string — and forgetting any of them is a security hole rather
    // than a visible bug. Routing them all through one place means a new route can't be added
    // without them, which is worth more here than the lines it saves
    app.post(path, async context => {
        const uid = await verify_uid(context.req.header('Authorization'))
        if (!uid){
            return context.json({error: 'unauthenticated'}, 401)
        }
        // A body that isn't valid JSON reads as absent, so a route wanting fields refuses it
        const body = await context.req.json().catch(() => null) as Record<string, unknown>|null
        const args = {} as Record<F[number], string>
        for (const field of fields as readonly F[number][]){
            const value = body?.[field]
            if (typeof value !== 'string'){
                return context.json({error: 'bad_request'}, 400)
            }
            args[field] = value
        }
        const result = await handler(uid, args, {context, body: body ?? {}})
        return context.json(result.body, result.status as 200)
    })
}


// Health check (harmless to keep; not required by Lambda/API Gateway's invoke model the way
// it was for Cloud Run's startup/liveness probes, but tests and manual checks still use it)
app.get('/api/health', context => {
    return context.json({ok: true})
})


// Compile a pending version server-side (in-browser compile fallback + regeneration)
// Only served by the 'compile' role — the one route needing typst, fonts, and Bible fetching
if (config.roles.includes('compile')){
    authed_post('/api/compile', ['version_id'], async (uid, {version_id}, {context, body}) => {
        // page_count is an advisory estimate for the auto binding-gutter only (see
        // margin_gutter_auto) — ignored unless it's a sane positive number
        const page_count = typeof body['page_count'] === 'number' && body['page_count'] > 0
            ? body['page_count']
            : undefined
        return await handle_compile(uid, version_id, get_client_ip(context),
            context.req.header('User-Agent') ?? null, page_count)
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

    // Preview a design invite link's target (name only, no membership change) — lets the client
    // show what's being shared before the user decides whether to accept it
    authed_post('/api/design_invite_preview', ['design_id', 'token'],
        async (_uid, {design_id, token}) =>
            await handle_design_invite_preview(design_id, token))

    // Redeem a design invite link (adds the caller as an editor)
    authed_post('/api/redeem_design_invite', ['design_id', 'token'],
        async (uid, {design_id, token}) =>
            await handle_redeem_design_invite(uid, design_id, token))

    // List a design's owner + editors with display name/email, for the share dialog
    authed_post('/api/design_editors', ['design_id'],
        async (uid, {design_id}) => await handle_design_editors(uid, design_id))

    // "Keep own copy" of a shared version (metadata + PDF are otherwise read directly from
    // Firestore/Storage by the client — see firestore.rules/firebase_storage.rules — since
    // versions are publicly readable by id; only the copy itself needs server-side Admin SDK
    // access)
    authed_post('/api/copy_version', ['version_id'],
        async (uid, {version_id}) => await handle_copy_version(uid, version_id))

    // Mark a design's uploaded fonts/images as still in use (GCS customTime). Fire-and-forget
    // from the client when a design is opened — see handle_touch_assets for why it exists
    authed_post('/api/touch_assets', ['design_id'],
        async (uid, {design_id}) => await handle_touch_assets(uid, design_id))

    // Reclaim the uploads a design no longer references. The server re-reads the design so
    // it sees co-editors' concurrent edits, which is why this can't be done client-side
    authed_post('/api/reconcile_design_assets', ['design_id'],
        async (uid, {design_id}) => await handle_reconcile_assets(uid, design_id))

    // Delete a design, its whole render history and every object they own. Server-side
    // because clients can't delete Storage objects, nor co-editors' version docs
    authed_post('/api/delete_design', ['design_id'],
        async (uid, {design_id}) => await handle_delete_design(uid, design_id))

    // Delete a single version: its doc, its PDFs, and any snapshot no sibling still needs
    authed_post('/api/delete_version', ['version_id'],
        async (uid, {version_id}) => await handle_delete_version(uid, version_id))

    // Copy a design's live content into a new design of the caller's own. Server-side so the
    // asset copies happen inside the bucket rather than through the client
    authed_post('/api/duplicate_design', ['design_id'],
        async (uid, {design_id}) => await handle_duplicate_design(uid, design_id))

    // Delete the caller's account and everything it owns. The body is ignored — the ID token is
    // both the authorisation and the entire subject, so there's nothing for a caller to name (and
    // therefore no way to aim this at anyone else). Callers still have to send one, since api()
    // in the app decides GET vs POST by whether a body was passed
    authed_post('/api/delete_account', [], async uid => await handle_delete_account(uid))

    // Merge a guest account's data into the (already signed-in) existing account
    authed_post('/api/merge_account', ['anon_token'],
        async (uid, {anon_token}) => await handle_merge(uid, anon_token))

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


// Last-resort capture of errors outside any request handler (fire-and-forget; both Lambda and
// the local dev_server share this — neither should crash the process over it, since Lambda
// replaces execution environments on its own terms and there's no Cloud-Run-style benefit to
// forcing an exit here)
function save_process_error(kind:string, error:unknown):void{
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
})
