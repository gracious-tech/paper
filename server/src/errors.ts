
import {createHash, randomBytes} from 'node:crypto'

import {admin_bucket} from './firebase.ts'
import {config} from './config.ts'

import {clean_text, is_ip, parse_report_body, MAX_BODY_CHARS, MAX_MESSAGE_CHARS}
    from './error_schema.ts'

import type {Context} from 'hono'
import type {HandlerResult} from './types.ts'
import type {ErrorRecord} from './error_schema.ts'

export type {ErrorRecord} from './error_schema.ts'


// Taking in error reports, stored in the default bucket as errors/{fingerprint}/{id}.json so
// identical repeats collapse into one prefix (grouping *different* messages is done later by
// .bin/audit_errors). What a report may contain is error_schema.ts'

// Per-IP report throttle (best-effort per-instance, like compile.ts' per-uid throttle)
const THROTTLE_LIMIT = 10
const THROTTLE_WINDOW_MS = 10 * 60 * 1000
const ip_reports = new Map<string, {count:number, since:number}>()


export function get_client_ip(context:Context):string|null{
    // The caller's IP. CloudFront sets CloudFront-Viewer-Address ('ip:port') itself, whereas the
    // first x-forwarded-for element is whatever the caller sent (CloudFront appends the real
    // address after it), so that's only a fallback for where there's no CloudFront (dev, tests)
    const viewer = context.req.header('cloudfront-viewer-address')
    const port_at = viewer?.lastIndexOf(':') ?? -1
    const address = viewer
        ? (port_at > 0 ? viewer.slice(0, port_at) : viewer)
        : context.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    return address && is_ip(address) ? address : null
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
    // Store an error report in the bucket, returning its id. A record without a `build` is the
    // server's own, so it gets this image's build (browser reports always pass theirs, even null).
    // Create-only, so a report can never replace another (a client picks its own report's id)
    // WARN Must never throw — reporting an error must not itself cause one
    try {
        const message = clean_text(record.message.slice(0, MAX_MESSAGE_CHARS))
        const full:ErrorRecord = {
            ...record,
            build: record.build === undefined ? config.build : record.build,
            message,
            fingerprint: fingerprint_message(message),
            timestamp: new Date().toISOString(),
        }
        await admin_bucket.file(`errors/${full.fingerprint}/${full.id}.json`)
            .save(JSON.stringify(full, undefined, 4), {contentType: 'application/json',
                resumable: false, preconditionOpts: {ifGenerationMatch: 0}})
    } catch (error){
        console.error('Failed to save error report', error)
    }
    return record.id
}


export async function handle_report_error(raw:string, ip:string|null, uid:string|null,
        user_agent:string|null):Promise<HandlerResult>{
    // Receive a browser error report and store it in the bucket. Only the shape in
    // error_schema.ts is accepted: what's stored is later read by AI during triage, so anything
    // else is refused rather than kept for it to read. Callers should already have applied the
    // per-IP rate limit
    if (raw.length > MAX_BODY_CHARS){
        return {status: 413, body: {error: 'too_large'}}
    }
    const report = parse_report_body(raw)
    if (!report){
        return {status: 400, body: {error: 'invalid_report'}}
    }
    const id = await save_error({
        id: report.id ?? generate_error_id(),
        source: 'browser',
        severity: report.severity ?? 'error',
        message: report.message,
        ip,
        uid,
        url: report.url ?? null,
        user_agent: user_agent === null ? null : clean_text(user_agent.slice(0, 500)),
        language: report.language ?? null,
        runtime_ms: report.runtime_ms ?? null,
        build: report.build ?? null,
        context: report.context ?? null,
    })
    return {status: 200, body: {id}}
}
