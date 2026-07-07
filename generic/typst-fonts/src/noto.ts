
// Manifest and helpers for the bundled Noto per-script fallback fonts. This data is static
// package content (see scripts/update_noto_data.ts, scripts/update_han_hints.ts) — it only
// changes when Noto's own fonts or the OpenCC dictionaries change upstream, never based on a
// consuming app's curated font choices, so no init call is required before use. Detects which
// Unicode scripts appear in a piece of text and resolves them to the specific Noto family that
// covers them, so a caller only needs the handful of fallback fonts its text actually uses
// instead of the full ~150MB Noto set (dominated by the five CJK regions).

import NOTO_MANIFEST from './generated/noto_manifest.json' with {type: 'json'}
import HAN_HINTS from './generated/han_hints.json' with {type: 'json'}

export type CjkVariant = 'JP' | 'KR' | 'SC' | 'TC' | 'HK'

// Serif/sans classification used to pick the Noto fallback that best matches a chosen font
export type FontStyle = 'serif' | 'sans'

/** A Noto family entry in the bundled fallback set */
export interface NotoFont {
    family:string
    files:string[]
}

// Regular scripts resolve straight to a family (or null if Noto has no coverage); CJK scripts
// (Han, Hiragana, Katakana, Hangul) resolve through a region since glyph shapes differ by locale
type ScriptFonts = {
    sans:string | Partial<Record<CjkVariant, string>> | null
    serif:string | Partial<Record<CjkVariant, string>> | null
}

export interface NotoManifest {
    sans:NotoFont[]
    serif:NotoFont[]
    by_script:Record<string, ScriptFonts>
}

const MANIFEST = NOTO_MANIFEST as unknown as NotoManifest

// Index by family name for fast lookup (a family only ever appears in one of sans/serif)
const by_family = new Map(
    [...MANIFEST.sans, ...MANIFEST.serif].map(f => [f.family, f])
)

// Look up a Noto fallback font by its family name
export function get_noto_font(family:string):NotoFont | undefined {
    return by_family.get(family)
}

// Scripts that are either not real detectable scripts, or already covered by whatever curated
// Latin font the caller is using — never worth adding as a fallback family
const SKIP_SCRIPTS = new Set(['Latin'])

// Build the list of detectable scripts once: pair each by_script key with a compiled
// \p{Script=...} regex, silently skipping any name the JS engine's Unicode database doesn't
// recognise as a valid Script value (a handful of Noto's script buckets, e.g. "Meroitic",
// don't map 1:1 onto a single Unicode Script property).
const SCRIPT_MATCHERS:{script:string, regex:RegExp}[] = []
for (const script of Object.keys(MANIFEST.by_script)) {
    if (SKIP_SCRIPTS.has(script)) continue
    try {
        SCRIPT_MATCHERS.push({script, regex: new RegExp(`\\p{Script=${script}}`, 'u')})
    } catch {
        // Not a recognised Unicode Script value — skip rather than guess
    }
}

// Detect which Noto-covered Unicode scripts appear anywhere in the given text
export function detect_scripts(text:string):Set<string> {
    const found = new Set<string>()
    for (const {script, regex} of SCRIPT_MATCHERS) {
        if (regex.test(text)) found.add(script)
    }
    return found
}

// Kana and Hangul are unambiguous markers of their language; Han characters alone are not
const KANA_REGEX = /\p{Script=Hiragana}|\p{Script=Katakana}/u
const HANGUL_REGEX = /\p{Script=Hangul}/u
const HAN_REGEX = /\p{Script=Han}/u

// Character-evidence regexes for Han-only text, generated from OpenCC's conversion tables by
// scripts/update_han_hints.ts: characters that only exist as simplified forms (气/们/图), only
// as traditional forms (氣/們/圖), or only as Japanese shinjitai (図/駅/売). Shared characters
// (the vast majority) match none of these and stay ambiguous. jp_gaps/kr_gaps are the Han
// characters the Noto JP/KR subset fonts can NOT render (range-compressed class source).
const SC_HINT_REGEX = new RegExp(`[${HAN_HINTS.sc}]`, 'u')
const TC_HINT_REGEX = new RegExp(`[${HAN_HINTS.tc}]`, 'u')
const JP_HINT_REGEX = new RegExp(`[${HAN_HINTS.jp}]`, 'u')
const JP_GAP_REGEX = new RegExp(`[${HAN_HINTS.jp_gaps}]`, 'u')
const KR_GAP_REGEX = new RegExp(`[${HAN_HINTS.kr_gaps}]`, 'u')

// Classify Han-only text. Shinjitai-only characters (図/駅) mean kanji-only Japanese. A JP or
// KR han_variant keeps the text in that region unless it needs glyphs the region's font lacks
// (the tofu condition) — SC/TC evidence chars alone can't overrule it, since traditional-only
// forms like 宮/東 are also everyday Japanese and KR hanja are traditional forms too. When the
// text can't stay in the default region, character evidence decides between the Chinese
// regions: simplified-only characters can only be SC, traditional-only characters mean TC
// (or HK — indistinguishable, so an explicit TC/HK han_variant wins). Text of purely shared
// characters is genuinely ambiguous and falls back to han_variant (or SC, broadest coverage,
// when a JP/KR default can't render it).
function classify_han(text:string, han_variant:CjkVariant):CjkVariant {
    if (JP_HINT_REGEX.test(text))
        return 'JP'
    if (han_variant === 'JP' && !JP_GAP_REGEX.test(text))
        return 'JP'
    if (han_variant === 'KR' && !KR_GAP_REGEX.test(text))
        return 'KR'
    const sc = SC_HINT_REGEX.test(text)
    const tc = TC_HINT_REGEX.test(text)
    if (sc && !tc)
        return 'SC'
    if (tc && !sc)
        return (han_variant === 'TC' || han_variant === 'HK') ? han_variant : 'TC'
    return (han_variant === 'JP' || han_variant === 'KR') ? 'SC' : han_variant
}

// Auto-detect the cover-wide default region for Han-only text: kana anywhere can only mean
// Japanese and Hangul can only mean Korean, then character evidence decides between the
// Chinese regions (simplified-only chars → SC, traditional-only → TC), defaulting to SC as
// the broadest-coverage region when the text is all shared characters
export function detect_cjk_variant(text:string):CjkVariant {
    if (KANA_REGEX.test(text))
        return 'JP'
    if (HANGUL_REGEX.test(text))
        return 'KR'
    return classify_han(text, 'SC')
}

/** A contiguous CJK range of a text with the language region its sentences belong to */
export interface CjkSegment {
    start:number
    end:number
    region:CjkVariant
}

// Characters that belong to a CJK run: Han/Hangul letters plus the full CJK-punctuation +
// kana blocks (U+3000-30FF — includes Script=Common marks like ー and ・ that sit inside
// words) and fullwidth forms (U+FF00-FFEF) so quotes/commas stay inside their sentence
const CJK_RUN_REGEX = /[\p{Script=Han}\p{Script=Hangul}　-ヿ＀-￯]+/gu

// Sentence boundaries for classification: CJK/ASCII sentence enders or line breaks. ASCII
// '.' is excluded — it appears in decimals/abbreviations, and CJK text normally uses '。'.
const SENTENCE_SPLIT_REGEX = /[。．！？!?]+|\n+/g

// Classify one sentence's language: kana → JP, Hangul → KR, Han-only → character evidence
// (so a Simplified Chinese sentence stays SC even on a cover whose default region is JP),
// null when it contains no CJK letters at all
function classify_sentence(text:string, han_variant:CjkVariant):CjkVariant | null {
    if (KANA_REGEX.test(text))
        return 'JP'
    if (HANGUL_REGEX.test(text))
        return 'KR'
    if (HAN_REGEX.test(text))
        return classify_han(text, han_variant)
    return null
}

// Resolve the Han-only tiebreaker region for one FIELD in auto mode: the field's own text
// decides where it can — same rules as sentence classification (kana → JP, Hangul → KR,
// character evidence, JP/KR renderability hold) applied to the whole field — and only a
// field with no signal of its own inherits the cover-wide default. This is the middle level
// of the sentence → field → cover tiebreaker hierarchy: an ambiguous sentence takes its
// language from the rest of its field before the rest of the cover.
export function field_cjk_variant(text:string, cover_variant:CjkVariant):CjkVariant {
    return classify_sentence(text, cover_variant) ?? cover_variant
}

// Split text into CJK segments and classify each one's language (kana can only be Japanese,
// Hangul only Korean, Han-only sentences classify by character evidence with han_variant as
// the tiebreaker for all-shared-character text). Classification happens per
// SENTENCE over the whole text — so Latin words or Typst markup interrupting a sentence
// (e.g. a bolded word inside a Japanese sentence) don't strand Han characters without their
// kana context — while the emitted segments cover only the pure-CJK character runs, which
// callers can safely wrap in Typst markup. This is what lets one blurb mix e.g. Japanese
// and Chinese sentences and render each with its own regional font — per-glyph fallback
// alone can't tell shared Han characters apart.
export function cjk_segments(text:string, han_variant:CjkVariant):CjkSegment[] {
    // Pass 1: classify whole sentences
    const sentences:{start:number, end:number, region:CjkVariant | null}[] = []
    let sentence_start = 0
    const add_sentence = (end:number) => {
        if (end > sentence_start) {
            const region = classify_sentence(text.slice(sentence_start, end), han_variant)
            sentences.push({start: sentence_start, end, region})
        }
        sentence_start = end
    }
    for (const boundary of text.matchAll(SENTENCE_SPLIT_REGEX)) {
        add_sentence(boundary.index! + boundary[0].length)
    }
    add_sentence(text.length)

    // Pass 2: emit the CJK runs, split at sentence boundaries and tagged with the enclosing
    // sentence's region; adjacent same-region pieces merge back together
    const segments:CjkSegment[] = []
    for (const run of text.matchAll(CJK_RUN_REGEX)) {
        const run_start = run.index!
        const run_end = run_start + run[0].length
        for (const sentence of sentences) {
            const start = Math.max(run_start, sentence.start)
            const end = Math.min(run_end, sentence.end)
            if (start >= end || sentence.region === null)
                continue
            const last = segments[segments.length - 1]
            if (last && last.region === sentence.region && last.end === start) {
                last.end = end
            }
            else {
                segments.push({start, end, region: sentence.region})
            }
        }
    }
    return segments
}

// Resolve the Noto CJK family covering a region in the given style (('JP', 'serif') →
// 'Noto Serif JP'); null only if the manifest is somehow missing the region
export function cjk_family(region:CjkVariant, style:FontStyle):string | null {
    return resolve_script_family(MANIFEST.by_script['Han']!, region, style)
}

// Resolve one script's {sans, serif} entry to a single concrete family: the preferred style
// when Noto covers the script in it, otherwise the other style (rendering something always
// beats style purity). CJK scripts (Han/Hiragana/Katakana/Hangul) resolve per-region via
// cjk_variant.
function resolve_script_family(
    fonts:ScriptFonts,
    cjk_variant:CjkVariant,
    style:FontStyle,
):string | null {
    const resolve = (entry:ScriptFonts['sans']):string | null => {
        if (entry === null) return null
        if (typeof entry === 'string') return entry
        return entry[cjk_variant] ?? null
    }
    return resolve(fonts[style]) ?? resolve(style === 'serif' ? fonts.sans : fonts.serif)
}

// The CJK scripts resolve through sentence segments (kana → JP, Hangul → KR, Han-only →
// han_variant) rather than through a single per-call region
const CJK_SCRIPTS = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul'])

// Build the font fallback chain for a piece of text: one Noto family per detected script,
// in the given style where available (Typst tries fonts in array order and skips glyphs it
// can't find, so the chosen font always stays first in the caller's chain). CJK families
// come from sentence-level segments — first-seen language first — so mixed-language text
// gets every region it uses; han_variant only decides Han-only sentences.
export function resolve_fallback_chain(
    text:string,
    han_variant:CjkVariant = 'SC',
    style:FontStyle = 'serif',
):string[] {
    const families = new Set<string>()
    for (const segment of cjk_segments(text, han_variant)) {
        const family = cjk_family(segment.region, style)
        if (family)
            families.add(family)
    }
    for (const script of detect_scripts(text)) {
        if (CJK_SCRIPTS.has(script))
            continue
        const family = resolve_script_family(MANIFEST.by_script[script]!, han_variant, style)
        if (family)
            families.add(family)
    }
    return [...families]
}
