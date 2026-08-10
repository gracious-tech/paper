
// Escape text for use in Typst markup content
export function escape_typst(text:string):string {
    return text.replace(/[\\#\[\]$*_`<>@~]/g, '\\$&')
}


// Quote-opening characters treated as a sentence boundary in their own right (see
// split_sentences) — straight quote/apostrophe chars are ambiguous (contractions, possessives,
// closing quotes) so only unambiguous curly/angle openers count. Also doubles as the pairing used
// by split_sentences to track quote depth (opener -> its matching closer) so quoted dialogue
// gets colored even where it isn't already bold/italic
const QUOTE_PAIRS:Record<string, string> = {'“': '”', '‘': '’', '«': '»', '„': '”'}
const QUOTE_OPENERS = Object.keys(QUOTE_PAIRS).join('')

// A stack of expected closers (innermost last), threaded in/out of split_sentences/
// emphasize_sentences so quote depth can be carried across calls — e.g. one call per
// picture-story slide, where dialogue that opens on one slide may not close until a later one
export type QuoteState = string[]


// Split text into "sentence" chunks for emphasize_sentences, each tagged with whether it's inside
// (or itself closes) a quote. A chunk is a run of characters up to and including its
// terminator(s) and any trailing closing quotes/brackets; or, if a quote opens before any
// terminator is reached, the narration up to (not including) that quote — so un-terminated
// narration leading into a quote ("...said: “Stop!”") splits off into its own (unwrapped) chunk
// instead of being pulled into the quote's emphasis span; or, symmetrically, a quote closing mid-
// chunk ("“Stop!” he said") ends the chunk right there so trailing narration doesn't inherit the
// quote's emphasis either; or the remainder of the text if none of the above is reached.
// quote_stack is the caller's running stack of expected closers — mutated in place (pushed on
// open, popped on close) so a caller processing a passage across multiple calls (e.g. a slide per
// verse range) can pass the same array through and have depth tracked in exactly one place,
// rather than this function and its caller each keeping their own copy that can drift apart
function split_sentences(text:string, quote_stack:QuoteState):{text:string, in_quote:boolean}[] {
    const sentences:{text:string, in_quote:boolean}[] = []
    let start = 0
    let i = 0
    while (i < text.length) {
        const ch = text[i]!
        const closer = quote_stack[quote_stack.length - 1]
        // Closing the innermost open quote — if that fully unwinds the stack, end the chunk here
        // (rather than only at the next terminator) so any trailing narration in the same source
        // sentence starts its own, unemphasized chunk
        if (closer && ch === closer) {
            quote_stack.pop()
            i++
            if (!quote_stack.length) {
                sentences.push({text: text.slice(start, i), in_quote: true})
                start = i
            }
            continue
        }
        if (i > start && QUOTE_OPENERS.includes(ch)) {
            sentences.push({text: text.slice(start, i), in_quote: quote_stack.length > 0})
            start = i
        }
        if (ch in QUOTE_PAIRS) {
            quote_stack.push(QUOTE_PAIRS[ch]!)
        }
        if ('.!?'.includes(ch)) {
            const chunk_in_quote = quote_stack.length > 0
            let j = i + 1
            while (j < text.length && '.!?'.includes(text[j]!)) {
                j++
            }
            while (j < text.length && '"\'’”)]'.includes(text[j]!)) {
                const trailing = text[j]!
                const trailing_closer = quote_stack[quote_stack.length - 1]
                if (trailing_closer && trailing === trailing_closer) {
                    quote_stack.pop()
                }
                j++
            }
            sentences.push({text: text.slice(start, j), in_quote: chunk_in_quote})
            start = j
            i = j
            continue
        }
        i++
    }
    if (start < text.length) {
        sentences.push({text: text.slice(start), in_quote: quote_stack.length > 0})
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
// sized per slide. quote_stack defaults to a fresh (empty) stack; pass one in (and reuse it across
// calls) to carry quote depth across a continuous run of separately-emphasized text — e.g. one
// call per picture-story slide, where a slide can open a quote its own text never closes
export function emphasize_sentences(
    text:string, color:string|null, quote_stack:QuoteState = [],
):string {
    const sentences = split_sentences(text, quote_stack)
    if (!sentences.length) {
        return escape_typst(text)
    }
    return sentences.map(({text: sentence, in_quote}) => {
        // Keep leading whitespace (incl. paragraph breaks) outside any wrapper
        const lead = sentence.match(/^\s*/)![0]
        const core = sentence.slice(lead.length)
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
