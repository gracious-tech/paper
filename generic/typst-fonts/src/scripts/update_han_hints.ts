
// MAINTAINER-ONLY script — regenerates the package's bundled, static generated/han_hints.json:
// character-evidence sets used to classify Han-only sentences by region (see classify_han in
// src/noto.ts). Derived from OpenCC's character conversion tables plus a cmap-coverage scan of
// the Noto Serif JP/KR fonts (fetched fresh into a temp dir via generated/noto_sources.json's
// URLs — never touches any app's own fonts_dir). Entirely independent of any consumer's
// curated font choices, so this only needs re-running when OpenCC or Noto's CJK fonts change
// upstream. Run via `npm run update-han-hints` (after `update-noto-data` if both are stale),
// then commit the resulting generated/han_hints.json by hand.

import {writeFile, mkdtemp, rm} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import noto_sources from '../generated/noto_sources.json' with {type: 'json'}

// Resolves to <package root>/src/generated regardless of whether this runs compiled (from
// dist/scripts/) or directly — the maintainer commits the result from source control either way
const __dirname = dirname(fileURLToPath(import.meta.url))
const GENERATED_PATH = join(__dirname, '..', '..', 'src', 'generated', 'han_hints.json')

// OpenCC's single-character conversion dictionaries (Apache-2.0)
const OPENCC_BASE = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/'
const ST_URL = OPENCC_BASE + 'STCharacters.txt'    // simplified -> traditional variant(s)
const TS_URL = OPENCC_BASE + 'TSCharacters.txt'    // traditional -> simplified variant(s)
const JP_URL = OPENCC_BASE + 'JPShinjitaiCharacters.txt'  // Japanese shinjitai -> kyūjitai

// True for a single Han character (one code point, Script=Han — surrogate pairs allowed)
const HAN_CHAR_REGEX = /^\p{Script=Han}$/u
function is_han_char(s:string):boolean {
    return HAN_CHAR_REGEX.test(s)
}

interface DictEntry {key:string, values:string[]}

// Fetch and parse an OpenCC dictionary: lines of "key\tvalue1 value2 ...".
// Only single-character keys/values are kept (some dictionaries contain multi-char words).
async function fetch_dict(url:string):Promise<DictEntry[]> {
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`)
    }
    const entries:DictEntry[] = []
    for (const line of (await resp.text()).split('\n')) {
        const [key, values] = line.split('\t')
        if (!key || !values || !is_han_char(key)) {
            continue
        }
        entries.push({key, values: values.trim().split(/\s+/).filter(is_han_char)})
    }
    return entries
}

// Parse an OTF/TTF cmap table and return the set of covered code points (formats 4 and 12)
function parse_cmap_coverage(buf:Buffer):Set<number> {
    const u16 = (o:number) => buf.readUInt16BE(o)
    const i16 = (o:number) => buf.readInt16BE(o)
    const u32 = (o:number) => buf.readUInt32BE(o)

    // Locate the cmap table in the sfnt table directory
    let cmap_off:number | null = null
    for (let i = 0; i < u16(4); i++) {
        const rec = 12 + i * 16
        if (buf.toString('latin1', rec, rec + 4) === 'cmap') {
            cmap_off = u32(rec + 8)
        }
    }
    if (cmap_off === null) {
        throw new Error('No cmap table found')
    }

    // Union the coverage of every subtable (Noto CJK carries format 4 for the BMP and
    // format 12 for the full range)
    const covered = new Set<number>()
    for (let i = 0; i < u16(cmap_off + 2); i++) {
        const off = cmap_off + u32(cmap_off + 4 + i * 8 + 4)
        const format = u16(off)
        if (format === 12) {
            for (let g = 0; g < u32(off + 12); g++) {
                const go = off + 16 + g * 12
                for (let c = u32(go); c <= u32(go + 4); c++) {
                    covered.add(c)
                }
            }
        }
        else if (format === 4) {
            const segcount = u16(off + 6) / 2
            const endo = off + 14
            const starto = endo + segcount * 2 + 2
            const deltao = starto + segcount * 2
            const rangeo = deltao + segcount * 2
            for (let s = 0; s < segcount; s++) {
                const end = u16(endo + s * 2)
                const start = u16(starto + s * 2)
                const delta = i16(deltao + s * 2)
                const range_off = u16(rangeo + s * 2)
                for (let c = start; c <= end && c !== 0xFFFF; c++) {
                    // Resolve the actual glyph id so notdef (0) mappings don't count
                    let glyph:number
                    if (range_off === 0) {
                        glyph = (c + delta) & 0xFFFF
                    }
                    else {
                        glyph = u16(rangeo + s * 2 + range_off + (c - start) * 2)
                        if (glyph !== 0) {
                            glyph = (glyph + delta) & 0xFFFF
                        }
                    }
                    if (glyph !== 0) {
                        covered.add(c)
                    }
                }
            }
        }
    }
    return covered
}

// Every Unicode code point with Script=Han (iterated once, surrogates skipped)
function han_universe():number[] {
    const out:number[] = []
    const han = /\p{Script=Han}/u
    for (let cp = 0; cp <= 0x10FFFF; cp++) {
        if (cp >= 0xD800 && cp <= 0xDFFF) {
            continue
        }
        if (han.test(String.fromCodePoint(cp))) {
            out.push(cp)
        }
    }
    return out
}

// Compress a sorted code point list into regex character-class source ("一-丂丄…") — all
// Han characters, so no class metacharacters need escaping
function to_class_ranges(codepoints:number[]):string {
    let out = ''
    let i = 0
    while (i < codepoints.length) {
        let j = i
        while (j + 1 < codepoints.length && codepoints[j + 1] === codepoints[j]! + 1) {
            j++
        }
        out += String.fromCodePoint(codepoints[i]!)
        if (j > i) {
            out += (j > i + 1 ? '-' : '') + String.fromCodePoint(codepoints[j]!)
        }
        i = j + 1
    }
    return out
}

// Fetch a Noto CJK font's Regular file fresh into a temp dir and return its coverage gaps
async function font_gaps(tmp_dir:string, family:string, universe:number[]):Promise<string> {
    const urls = (noto_sources as Record<string, string[]>)[family]
    if (!urls || urls.length === 0) {
        throw new Error(`No source URL for "${family}" in noto_sources.json`)
    }
    const url = urls[0]!  // Regular is always first
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`)
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    await writeFile(join(tmp_dir, `${family}.otf`), buf)
    const covered = parse_cmap_coverage(buf)
    return to_class_ranges(universe.filter(cp => !covered.has(cp)))
}

const tmp_dir = await mkdtemp(join(tmpdir(), 'typst-fonts-han-hints-'))
try {
    console.log('Fetching OpenCC dictionaries...')
    const [st, ts, jp] = await Promise.all([fetch_dict(ST_URL), fetch_dict(TS_URL), fetch_dict(JP_URL)])

    // Characters valid on the simplified side (ST keys + TS values) and on the traditional side
    // (TS keys + ST values). Ambiguous characters like 后 (simplified for 後 AND a traditional
    // character itself) appear on both sides and are excluded from all evidence sets.
    const simp_side = new Set([...st.map(e => e.key), ...ts.flatMap(e => e.values)])
    const trad_side = new Set([...ts.map(e => e.key), ...st.flatMap(e => e.values)])
    const chinese = new Set([...simp_side, ...trad_side])

    // Evidence sets: characters that can ONLY be one thing
    const sc = [...st.map(e => e.key)].filter(c => !trad_side.has(c))
    const tc = [...ts.map(e => e.key)].filter(c => !simp_side.has(c))
    // JP shinjitai forms (the dictionary's KEYS — it maps shinjitai -> kyūjitai) that actually
    // differ from their kyūjitai source and aren't valid Chinese characters at all
    const jp_keys = jp.filter(e => e.values.some(v => v !== e.key)).map(e => e.key)
    const jp_only = [...new Set(jp_keys)].filter(c => !chinese.has(c))

    // Coverage gaps of the JP/KR subset fonts across every Han character in Unicode
    console.log('Scanning JP/KR font coverage...')
    const universe = han_universe()
    const jp_gaps = await font_gaps(tmp_dir, 'Noto Serif JP', universe)
    const kr_gaps = await font_gaps(tmp_dir, 'Noto Serif KR', universe)

    const hints = {
        sc: [...new Set(sc)].sort().join(''),
        tc: [...new Set(tc)].sort().join(''),
        jp: [...new Set(jp_only)].sort().join(''),
        jp_gaps,
        kr_gaps,
    }
    await writeFile(GENERATED_PATH, JSON.stringify(hints, null, 4) + '\n')
    console.log(`Generated ${GENERATED_PATH}`)
    for (const [key, value] of Object.entries(hints)) {
        console.log(`  ${key}: ${[...value].length} chars`)
    }
    console.log('Done.')
} finally {
    await rm(tmp_dir, {recursive: true, force: true})
}
