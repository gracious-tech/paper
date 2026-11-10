import {z} from 'zod'


// The shape of an error report, shared by the server (taking reports in) and .bin/audit_errors
// (loading them back). Reports are public, unauthenticated input that AI reads during triage, so
// both sides accept a strict shape only: exact keys, typed, length-capped, every field that ends
// up in a path or a command matched by a regex, and text cleaned of anything that could hide or
// disguise what it says. Kept free of server imports so the triage tool can load it alone


// A single reported error (browser or server), stored in the default bucket as
// errors/{fingerprint}/{id}.json so identical repeats collapse into one prefix at list time
export interface ErrorRecord {
    id:string  // 20-char url64
    fingerprint:string  // 12 hex chars (also the object's path prefix)
    timestamp:string  // ISO 8601, server clock
    source:'browser'|'server'
    severity:'critical'|'error'|'silent'
    message:string  // Message + stack, truncated
    ip:string|null  // Caller's IP (see get_client_ip())
    uid:string|null  // When a valid ID token accompanied the report
    url:string|null  // location.href (browser) / route path (server)
    user_agent:string|null
    language:string|null  // navigator.language (browser only)
    runtime_ms:number|null  // Time since app load (browser only)
    // Commit the reporting code was built from (short hash, maybe '-dirty'); null when unknown,
    // and absent from reports that predate build stamping
    build?:string|null
    context:Record<string, string|number>|null  // e.g. {version_id: '...'}
}


// Caps: the whole request body, the message (truncated, since a long stack is still worth
// having), and every other text field (refused when longer)
export const MAX_BODY_CHARS = 64_000
export const MAX_MESSAGE_CHARS = 16_384
export const MAX_CONTEXT_CHARS = 1000
export const MAX_CONTEXT_KEYS = 20

// Fields that end up in paths (id, fingerprint) or git arguments (build)
export const REPORT_ID = /^[A-Za-z0-9_~-]{20}$/
export const FINGERPRINT = /^[0-9a-f]{12}$/
export const BUILD = /^(?:[0-9a-f]{7,40}(?:-dirty)?|dev|unknown)$/
const CONTEXT_KEY = /^[a-z][a-z0-9_]{0,39}$/
const IP = /^[0-9A-Fa-f:.]{1,45}$/
const UID = /^[A-Za-z0-9_-]{1,128}$/

// Terminal escape sequences (CSI, OSC, and two-character escapes)
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g
// Control characters other than tab and newline, plus characters that render as nothing or
// reorder what's around them: soft hyphen, zero-width and joiners, bidi marks/embeddings/
// isolates, word joiners and invisible operators, the BOM, and Unicode tag characters (which
// can spell out hidden text a model still reads)
const INVISIBLE = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/gu


export function clean_text(text:string):string{
    // Strip what could hide or disguise text from whoever (or whatever) reads it
    return text.replace(ANSI, '').replace(INVISIBLE, '')
}


export function is_ip(value:string):boolean{
    // Whether a value looks like an IPv4/IPv6 address (shape only)
    return IP.test(value)
}


// Text of at most `max` chars, cleaned
const text = (max:number) => z.string().max(max).transform(clean_text)

// The message, truncated rather than refused, then cleaned
const message = z.string().transform(value => clean_text(value.slice(0, MAX_MESSAGE_CHARS)))

// Extra detail a report carries: a few short, flat, named values
const context = z.record(z.string().regex(CONTEXT_KEY),
    z.union([text(MAX_CONTEXT_CHARS), z.number().finite()]))
    .refine(value => Object.keys(value).length <= MAX_CONTEXT_KEYS, 'Too many context entries')

const severity = z.enum(['critical', 'error', 'silent'])


// What a browser may send to /api/report_error (see save_error() in app/src/services/errors.ts
// and app/public/boot_check.js). Everything else about a report the server decides itself
const ReportBody = z.strictObject({
    id: z.string().regex(REPORT_ID).optional(),
    severity: severity.optional(),
    message,
    url: text(1000).optional(),
    language: text(50).optional(),
    runtime_ms: z.number().finite().optional(),
    build: z.string().regex(BUILD).optional(),
    context: context.optional(),
})
export type ReportBody = z.output<typeof ReportBody>


// A stored record, as the triage tool loads it back. Checked again there rather than trusting
// that whatever wrote the bucket (or the local copy since) kept to the shape
const ErrorRecordSchema = z.strictObject({
    id: z.string().regex(REPORT_ID),
    fingerprint: z.string().regex(FINGERPRINT),
    timestamp: z.iso.datetime(),
    source: z.enum(['browser', 'server']),
    severity,
    message: z.string().max(MAX_MESSAGE_CHARS).transform(clean_text),
    ip: z.string().regex(IP).nullable(),
    uid: z.string().regex(UID).nullable(),
    url: text(1000).nullable(),
    user_agent: text(500).nullable(),
    language: text(50).nullable(),
    runtime_ms: z.number().finite().nullable(),
    build: z.string().regex(BUILD).nullable().optional(),
    context: context.nullable(),
}) satisfies z.ZodType<ErrorRecord>


export function parse_report_body(raw:string):ReportBody|null{
    // A report body in the accepted shape, or null if it's anything else
    let body:unknown
    try {
        body = JSON.parse(raw)
    } catch {
        return null
    }
    const result = ReportBody.safeParse(body)
    return result.success ? result.data : null
}


export function parse_error_record(value:unknown):ErrorRecord|null{
    // A stored record in the accepted shape (text cleaned), or null if it's anything else
    const result = ErrorRecordSchema.safeParse(value)
    return result.success ? result.data : null
}
