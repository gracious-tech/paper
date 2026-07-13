
// Escape text for use in Typst markup content
export function escape_typst(text:string):string {
    return text.replace(/[\\#\[\]$*_`<>@~]/g, '\\$&')
}


// Books that almost always need 2-column layout due to size and poetry line breaks
export const LARGE_POETRY = ['job', 'psa', 'pro', 'isa', 'jer', 'ezk']


// Books that have a substantial amount of poetry (not just a stanza here and there)
export const LOTS_OF_POETRY = [
    'job', 'psa', 'pro', 'ecc', 'sng',
    'isa', 'jer', 'lam', 'ezk',
    'hos', 'jol', 'amo', 'oba',
    'mic', 'nam', 'hab', 'zep', 'hag', 'zec',
]


// Indent every line of a string by the given number of spaces
export function indent(text:string, spaces:number = 4):string {
    const pad = ' '.repeat(spaces)
    return text.split('\n').map(line => line ? pad + line : line).join('\n')
}


// Parse a Typst unit string like "210mm" or "10pt" into numeric value and unit
export function parse_unit(value:string):{num:number, unit:string} {
    const match = value.match(/^([\d.]+)\s*(mm|cm|in|pt|em)$/)
    if (!match) {
        throw new Error(`Invalid Typst unit string: "${value}"`)
    }
    return {num: parseFloat(match[1]!), unit: match[2]!}
}


// Rough size of a fetched JSON-based value, for cache budgeting (approximate is fine — the
// budget only exists to bound memory, not to account it exactly)
export function estimate_bytes(value:unknown):number {
    if (value === null || value === undefined) {
        return 8
    }
    try {
        return JSON.stringify(value).length
    } catch {
        // Unserializable — assume large so the cache budget stays conservative
        return 1024 * 1024
    }
}


// Byte-capped LRU cache backed by Map insertion order (get() refreshes recency). A null cap
// means unbounded (plain Map behaviour). If a single entry exceeds the cap it is still kept —
// evicting the value just fetched would defeat the point of caching it. A null ttl_ms means
// entries never expire by time, only by LRU eviction
export class LruCache<V> {

    private max_bytes:number|null
    private ttl_ms:number|null
    private entries = new Map<string, {value:V, bytes:number, fetched:number}>()
    private total = 0

    constructor(max_bytes:number|null = null, ttl_ms:number|null = null) {
        this.max_bytes = max_bytes
        this.ttl_ms = ttl_ms
    }

    // Whether the key is cached and not yet stale (does not refresh recency — pair with get())
    has(key:string):boolean {
        return this.get_live(key) !== undefined
    }

    // Get a cached value, marking it most-recently-used. Stale entries are evicted and treated
    // as a miss
    get(key:string):V|undefined {
        const entry = this.get_live(key)
        if (!entry) {
            return undefined
        }
        // Re-insert so Map iteration order reflects recency (oldest first)
        this.entries.delete(key)
        this.entries.set(key, entry)
        return entry.value
    }

    // Look up an entry without touching recency, evicting it first if past ttl_ms
    private get_live(key:string):{value:V, bytes:number, fetched:number}|undefined {
        const entry = this.entries.get(key)
        if (!entry) {
            return undefined
        }
        if (this.ttl_ms !== null && Date.now() - entry.fetched > this.ttl_ms) {
            this.entries.delete(key)
            this.total -= entry.bytes
            return undefined
        }
        return entry
    }

    // Store a value with its estimated size, evicting least-recently-used entries over budget
    set(key:string, value:V, bytes:number):void {
        const existing = this.entries.get(key)
        if (existing) {
            this.total -= existing.bytes
            this.entries.delete(key)
        }
        this.entries.set(key, {value, bytes, fetched: Date.now()})
        this.total += bytes
        if (this.max_bytes === null) {
            return
        }
        for (const [old_key, old_entry] of this.entries) {
            if (this.total <= this.max_bytes || old_key === key) {
                break
            }
            this.entries.delete(old_key)
            this.total -= old_entry.bytes
        }
    }

    // Number of cached entries (mainly for tests/diagnostics)
    get size():number {
        return this.entries.size
    }

    // Total estimated bytes currently cached (mainly for tests/diagnostics)
    get bytes():number {
        return this.total
    }
}


// Convert a value to mm for calculation purposes
export function to_mm(value:number, unit:string):number {
    switch (unit) {
        case 'mm':
            return value
        case 'cm':
            return value * 10
        case 'in':
            return value * 25.4
        case 'pt':
            return value * 0.3528
        default:
            return value
    }
}
