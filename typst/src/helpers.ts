
// Escape text for use in Typst markup content
export function escape_typst(text:string):string {
    return text.replace(/[\\#\[\]$*_`<>@~]/g, '\\$&')
}


// Quote-opening characters treated as a sentence boundary in their own right (see
// split_sentences) — straight quote/apostrophe chars are ambiguous (contractions, possessives,
// closing quotes) so only unambiguous curly/angle openers count. Also doubles as the pairing used
// by emphasize_sentences to track quote depth (opener -> its matching closer) so quoted dialogue
// gets colored even where it isn't already bold/italic
const QUOTE_PAIRS:Record<string, string> = {'“': '”', '‘': '’', '«': '»', '„': '”'}
const QUOTE_OPENERS = Object.keys(QUOTE_PAIRS).join('')


// Split text into "sentence" chunks for emphasize_sentences: a run of characters up to and
// including its terminator(s) and any trailing closing quotes/brackets; or, if a quote opens
// before any terminator is reached, the narration up to (not including) that quote — so
// un-terminated narration leading into a quote ("...said: “Stop!”") splits off into its own
// (unwrapped) chunk instead of being pulled into the quote's emphasis span; or the remainder of
// the text if neither is reached
function split_sentences(text:string):string[] {
    const sentences:string[] = []
    let start = 0
    let i = 0
    while (i < text.length) {
        const ch = text[i]!
        if (i > start && QUOTE_OPENERS.includes(ch)) {
            sentences.push(text.slice(start, i))
            start = i
            continue
        }
        if ('.!?'.includes(ch)) {
            let j = i + 1
            while (j < text.length && '.!?'.includes(text[j]!)) {
                j++
            }
            while (j < text.length && '"\'’”)]'.includes(text[j]!)) {
                j++
            }
            sentences.push(text.slice(start, j))
            start = j
            i = j
            continue
        }
        i++
    }
    if (start < text.length) {
        sentences.push(text.slice(start))
    }
    return sentences
}


// Escape plain text for Typst while auto-emphasizing sentence tone: sentences ending in "?" are
// italicized and those ending in "!" are emboldened, both enlarged; quoted dialogue that's
// neither (e.g. a plain statement) is still enlarged and colored, just without the bold/italic —
// so a whole quote reads consistently even when only part of it is a question/exclamation. Color
// (if given) applies to any of the above. Runs on plain text (not Typst markup) so sentence
// detection stays reliable — leading whitespace/paragraph breaks are kept outside the emphasis
// wrapper so paragraphs still break. Used for picture-story passage prose. "em" sizes scale
// relative to whatever text size is active where this markup is placed (see gen_fit_body), so
// they stay proportionally the same even though picture-story body text itself is dynamically
// sized per slide
export function emphasize_sentences(text:string, color:string|null):string {
    const sentences = split_sentences(text)
    if (!sentences.length) {
        return escape_typst(text)
    }
    // Tracks unmatched open quotes across segments (a stack of expected closers) — quoted
    // dialogue spanning multiple sentences (e.g. two questions in a row) still counts as "in a
    // quote" once split_sentences has broken it into separate segments
    const quote_stack:string[] = []
    return sentences.map(sentence => {
        // Keep leading whitespace (incl. paragraph breaks) outside any wrapper
        const lead = sentence.match(/^\s*/)![0]
        const core = sentence.slice(lead.length)
        const in_quote = quote_stack.length > 0 || core[0] in QUOTE_PAIRS
        for (const ch of core) {
            const closer = quote_stack[quote_stack.length - 1]
            if (closer && ch === closer) {
                quote_stack.pop()
            } else if (ch in QUOTE_PAIRS) {
                quote_stack.push(QUOTE_PAIRS[ch]!)
            }
        }
        // The sentence's terminator, ignoring trailing quotes/brackets
        const terminator = core.replace(/["'”’)\]]*$/, '').slice(-1)
        const escaped = escape_typst(core)
        const args = terminator === '?' ? ['size: 1.4em', 'style: "italic"']
            : terminator === '!' ? ['size: 1.4em', 'weight: "bold"']
            : in_quote ? ['size: 1.4em']
            : []
        if (args.length && color) {
            args.push(`fill: rgb("${color}")`)
        }
        const wrapped = args.length ? `#text(${args.join(', ')})[${escaped}]` : escaped
        return escape_typst(lead) + wrapped
    }).join('')
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
