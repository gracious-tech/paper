
import {createHash, randomBytes} from 'node:crypto'

import {admin_bucket} from './firebase.ts'

import type {Context} from 'hono'


// A single reported error (browser or server), stored in the default bucket as
// errors/{fingerprint}/{id}.json so identical repeats collapse into one prefix at list time
// (semantic grouping of *different* messages is done later by the .bin/errors tooling with AI)
export interface ErrorRecord {
    id:string  // 20-char url64
    fingerprint:string  // 12 hex chars (also the object's path prefix)
    timestamp:string  // ISO 8601, server clock
    source:'browser'|'server'
    severity:'critical'|'error'|'silent'
    message:string  // Message + stack, truncated
    ip:string|null  // Caller's IP (first x-forwarded-for element)
    uid:string|null  // When a valid ID token accompanied the report
    url:string|null  // location.href (browser) / route path (server)
    user_agent:string|null
    language:string|null  // navigator.language (browser only)
    runtime_ms:number|null  // Time since app load (browser only)
    context:Record<string, string|number>|null  // e.g. {version_id: '...'}
}


// Cap stored messages so a single report can't be abused to bloat the bucket
const MAX_MESSAGE_CHARS = 16_384

// Per-IP report throttle (best-effort per-instance, like compile.ts' per-uid throttle)
const THROTTLE_LIMIT = 10
const THROTTLE_WINDOW_MS = 10 * 60 * 1000
const ip_reports = new Map<string, {count:number, since:number}>()


export function get_client_ip(context:Context):string|null{
    // The caller's IP — first x-forwarded-for element (Hosting/Cloud Run append their own hops)
    const first = context.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    return first || null
}


export function generate_error_id():string{
    // URL-safe base64 id for an error report (15 bytes = 20 chars, no padding)
    return randomBytes(15).toString('base64url')
}


export function report_allowed(ip:string|null):boolean{
    // Best-effort per-IP throttle so a stuck client can't flood the bucket
    const key = ip ?? 'unknown'
    const now = Date.now()
    const entry = ip_reports.get(key)
    if (!entry || now - entry.since > THROTTLE_WINDOW_MS){
        // Bound the map so it can't grow unchecked over a long-lived instance
        if (ip_reports.size > 1000){
            ip_reports.clear()
        }
        ip_reports.set(key, {count: 1, since: now})
        return true
    }
    entry.count += 1
    return entry.count <= THROTTLE_LIMIT
}


function fingerprint_message(message:string):string{
    // Stable dedupe key for near-identical messages — NOT semantic matching; just normalises
    // volatile parts (urls/ids/numbers) out of the first few lines (stack excluded, as minified
    // frames change every deploy)
    const normalised = message.split('\n').slice(0, 3).join('\n')
        .replace(/https?:\/\/\S+/g, 'URL')
        .replace(/[A-Za-z0-9\-_~]{16,}/g, 'ID')
        .replace(/\d+/g, '#')
        .toLowerCase()
    return createHash('sha256').update(normalised).digest('hex').slice(0, 12)
}


export async function save_error(record:Omit<ErrorRecord, 'fingerprint'|'timestamp'>)
        :Promise<string>{
    // Store an error report in the bucket, returning its id
    // WARN Must never throw — reporting an error must not itself cause one
    try {
        const message = record.message.slice(0, MAX_MESSAGE_CHARS)
        const full:ErrorRecord = {
            ...record,
            message,
            fingerprint: fingerprint_message(message),
            timestamp: new Date().toISOString(),
        }
        await admin_bucket.file(`errors/${full.fingerprint}/${full.id}.json`)
            .save(JSON.stringify(full, undefined, 4), {contentType: 'application/json'})
    } catch (error){
        console.error('Failed to save error report', error)
    }
    return record.id
}


// Cap the raw request body read before parsing so an oversized payload can't waste CPU/storage
const MAX_BODY_CHARS = 64_000


export async function handle_report_error(raw:string, ip:string|null, uid:string|null,
        user_agent:string|null):Promise<{status:number, body:Record<string, unknown>}>{
    // Receive a browser error report and store it in the bucket
    // This should never itself fail to report — oversized/malformed payloads are trimmed/flagged
    // and still saved, so triage can see the client is sending bad data, rather than the report
    // being rejected and lost. Callers should already have applied the per-IP rate limit
    const truncated = raw.length > MAX_BODY_CHARS
    const text = truncated ? raw.slice(0, MAX_BODY_CHARS) : raw
    let body:Record<string, unknown>|null = null
    try {
        body = JSON.parse(text) as Record<string, unknown>
    } catch {
        // Handled below — fall back to storing the raw text as the message
    }
    const malformed = typeof body?.['message'] !== 'string'
    const message = malformed ? `[malformed report] ${text.slice(0, 500)}` : body!['message'] as string

    // Loosely validate optional fields, dropping anything malformed rather than rejecting
    const id = typeof body?.['id'] === 'string' && /^[A-Za-z0-9\-_~]{20}$/.test(body['id'] as string)
        ? body['id'] as string : generate_error_id()
    const severity = ['critical', 'error', 'silent'].includes(body?.['severity'] as string)
        ? body!['severity'] as 'critical'|'error'|'silent' : 'error'
    const extra = body?.['context'] && typeof body['context'] === 'object'
        ? Object.fromEntries(Object.entries(body['context'] as Record<string, unknown>)
            .filter(([, value]) => ['string', 'number'].includes(typeof value))
            .slice(0, 20)) as Record<string, string|number>
        : {}
    if (truncated){
        extra['truncated'] = 'true'
    }
    if (malformed){
        extra['malformed'] = 'true'
    }

    const returned_id = await save_error({
        id,
        source: 'browser',
        severity,
        message,
        ip,
        uid,
        url: typeof body?.['url'] === 'string' ? (body['url'] as string).slice(0, 1000) : null,
        user_agent: user_agent?.slice(0, 500) ?? null,
        language: typeof body?.['language'] === 'string' ? (body['language'] as string).slice(0, 50)
            : null,
        runtime_ms: typeof body?.['runtime_ms'] === 'number' ? body['runtime_ms'] as number : null,
        context: Object.keys(extra).length ? extra : null,
    })
    return {status: 200, body: {id: returned_id}}
}
