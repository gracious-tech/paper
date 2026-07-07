
// MAINTAINER-ONLY script — regenerates the package's bundled, static Noto data:
// generated/noto_manifest.json (public {sans, serif, by_script} shape) and
// generated/noto_sources.json (family -> source URLs, used only by download/noto.ts). Neither
// file is app-specific — they only need regenerating when Noto's own fonts change upstream.
// Run via `npm run update-noto-data`, then commit the resulting generated/*.json by hand.

import {writeFile} from 'node:fs/promises'
import {dirname, join, basename} from 'node:path'
import {fileURLToPath} from 'node:url'

// Resolves to <package root>/src/generated regardless of whether this runs compiled (from
// dist/scripts/) or directly — the maintainer commits the result from source control either way
const __dirname = dirname(fileURLToPath(import.meta.url))
const GENERATED_DIR = join(__dirname, '..', '..', 'src', 'generated')
const STATE_URL = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/state.json'
const RAW_BASE = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/'
const CJK_RAW_BASE = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/'

interface NotoFont {family:string, files:string[]}
type ScriptFonts = {
    sans:string | Record<string, string> | null
    serif:string | Record<string, string> | null
}
interface NotoManifest {sans:NotoFont[], serif:NotoFont[], by_script:Record<string, ScriptFonts>}

// CJK subset fonts (JP, KR, SC, TC, HK) — not in state.json, hardcoded here. Each region gets
// its own family + directory so callers can fetch/scan a single family instead of all five.
const CJK_REGIONS = ['JP', 'KR', 'SC', 'TC', 'HK']
const CJK_WEIGHTS = ['Regular', 'Bold']
const CJK_SANS = CJK_REGIONS.map(r => ({
    family: `Noto Sans ${r}`,
    files: CJK_WEIGHTS.map(w => `NotoSans${r}-${w}.otf`),
    urls: CJK_WEIGHTS.map(w => `${CJK_RAW_BASE}Sans/SubsetOTF/${r}/NotoSans${r}-${w}.otf`),
}))
const CJK_SERIF = CJK_REGIONS.map(r => ({
    family: `Noto Serif ${r}`,
    files: CJK_WEIGHTS.map(w => `NotoSerif${r}-${w}.otf`),
    urls: CJK_WEIGHTS.map(w => `${CJK_RAW_BASE}Serif/SubsetOTF/${r}/NotoSerif${r}-${w}.otf`),
}))
// The 4 Unicode scripts shared by all CJK regions, each resolved per-region via cjk_variant
const CJK_SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Hangul']

// Families to exclude (non-text: monospace, display, math, color emoji, UI variants)
const EXCLUDE = / UI$|Mono|Display|Math|Color/

// Families already published at the top level of an app's fonts/ dir by the per-app download
// step (with all four weights including italics) — not listed here so they don't exist twice.
// by_script still names them (Latin/Greek/Cyrillic winners): the generator resolves curated
// families before Noto fallbacks, so those scripts land on the top-level copies.
const CURATED_DUPLICATES = new Set(['Noto Sans', 'Noto Serif'])

// state.json script keys that aren't real Unicode Script property values (junk entries,
// numeral systems, or style variants of a script already covered under another key) —
// excluded from by_script entirely rather than guessed at.
const SCRIPT_KEY_EXCLUDE = new Set([
    'test', 'math', 'symbols', 'nastaliq', 'old-hungarian-ui', 'hentaigana',
    'ottoman-siyaq-numbers', 'indic-siyaq-numbers', 'mayan-numerals',
])
// state.json script keys that map to more than one real Unicode script
const SCRIPT_KEY_OVERRIDES:Record<string, string[]> = {
    'latin-greek-cyrillic': ['Latin', 'Greek', 'Cyrillic'],
}

// Convert a state.json script key (kebab-case) to Unicode Script property name(s)
// ('Old_Hungarian', 'Meetei_Mayek', ...); returns [] for keys that should be skipped.
function script_names(key:string):string[] {
    if (SCRIPT_KEY_EXCLUDE.has(key)) return []
    if (SCRIPT_KEY_OVERRIDES[key]) return SCRIPT_KEY_OVERRIDES[key]
    return [key.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join('_')]
}

// Select the desired font files from state.json paths for a given family.
// Prefers unhinted OTF; falls back to unhinted TTF. Only Regular and Bold, non-variable.
function select_files(family_name:string, raw_files:string[]):string[] {
    const base = family_name.replace(/\s+/g, '')

    const match_otf = (f:string) =>
        f.includes('/unhinted/otf/') &&
        (basename(f) === `${base}-Regular.otf` || basename(f) === `${base}-Bold.otf`)

    const match_ttf = (f:string) =>
        f.includes('/unhinted/ttf/') &&
        !f.includes('[wght]') &&
        (basename(f) === `${base}-Regular.ttf` || basename(f) === `${base}-Bold.ttf`)

    const otf = raw_files.filter(match_otf)
    if (otf.length > 0) return otf
    return raw_files.filter(match_ttf)
}

interface StateFamily {files?:string[], latest_release?:unknown}
interface StateScript {families?:Record<string, StateFamily>}

// Fetch and parse state.json
console.log('Fetching state.json...')
const state_resp = await fetch(STATE_URL)
if (!state_resp.ok) {
    throw new Error(`Failed to fetch state.json: ${state_resp.status}`)
}
const state = await state_resp.json() as Record<string, StateScript>

// Build family map and per-script coverage maps
const family_map = new Map<string, {type:'sans' | 'serif', repo_paths:string[], files:string[]}>()
const sans_by_script = new Map<string, Set<string>>()
const serif_by_script = new Map<string, Set<string>>()

for (const [script, script_data] of Object.entries(state)) {
    if (!script_data?.families) continue

    for (const [family_name, family_data] of Object.entries(script_data.families)) {
        if (!family_data?.files?.length || !family_data.latest_release) continue

        const is_sans = family_name.startsWith('Noto Sans') && !EXCLUDE.test(family_name)
        const is_serif = family_name.startsWith('Noto Serif') && !EXCLUDE.test(family_name)
        if (!is_sans && !is_serif) continue

        // Track which scripts this family type covers
        const by_script = is_serif ? serif_by_script : sans_by_script
        if (!by_script.has(script)) by_script.set(script, new Set())
        by_script.get(script)!.add(family_name)

        // Deduplicate: only process each family name once
        if (family_map.has(family_name)) continue

        const selected = select_files(family_name, family_data.files)
        const has_regular = selected.some(f => f.includes('-Regular.'))
        if (!has_regular) {
            process.stdout.write(`  Warning: no Regular file found for "${family_name}"\n`)
            continue
        }

        family_map.set(family_name, {
            type: is_serif ? 'serif' : 'sans',
            repo_paths: selected,
            files: selected.map(p => basename(p)),
        })
    }
}

// Pick one winner per script: the valid family with the shortest name (most generic)
function pick_winner(family_names:Set<string>, families:Map<string, unknown>):string | null {
    return [...family_names]
        .filter(n => families.has(n))
        .sort((a, b) => a.length - b.length)[0] ?? null
}

const sans_winners = new Map<string, string>()
const serif_winners = new Map<string, string>()

for (const [script, families] of sans_by_script) {
    const winner = pick_winner(families, family_map)
    if (winner) sans_winners.set(script, winner)
}
for (const [script, families] of serif_by_script) {
    const winner = pick_winner(families, family_map)
    if (winner) serif_winners.set(script, winner)
}

// Build the script -> {sans, serif} lookup table — Noto's own authoritative script coverage,
// straight from state.json, keyed by real Unicode Script property names so callers can detect
// scripts in text via \p{Script=...} and resolve straight to a font family.
const by_script:Record<string, ScriptFonts> = {}
const all_scripts = new Set([...sans_winners.keys(), ...serif_winners.keys()])
for (const script of all_scripts) {
    for (const name of script_names(script)) {
        by_script[name] = {
            sans: sans_winners.get(script) ?? null,
            serif: serif_winners.get(script) ?? null,
        }
    }
}
// CJK scripts resolve through a region (cjk_variant), not a single family
for (const script of CJK_SCRIPTS) {
    by_script[script] = {
        sans: Object.fromEntries(CJK_SANS.map(e => [e.family.slice(-2), e.family])),
        serif: Object.fromEntries(CJK_SERIF.map(e => [e.family.slice(-2), e.family])),
    }
}

// Build sans array: unique sans winners + serif fallbacks for scripts with no sans
const sans_included = new Set(sans_winners.values())
const sans_array = [...sans_included].map(name => ({family: name, files: family_map.get(name)!.files}))

for (const [script, serif_name] of serif_winners) {
    if (!sans_winners.has(script) && !sans_included.has(serif_name)) {
        sans_included.add(serif_name)
        sans_array.push({family: serif_name, files: family_map.get(serif_name)!.files})
    }
}

// Build serif array: unique serif winners + sans fallbacks for scripts with no serif
const serif_included = new Set(serif_winners.values())
const serif_array = [...serif_included].map(name => ({family: name, files: family_map.get(name)!.files}))

for (const [script, sans_name] of sans_winners) {
    if (!serif_winners.has(script) && !serif_included.has(sans_name)) {
        serif_included.add(sans_name)
        serif_array.push({family: sans_name, files: family_map.get(sans_name)!.files})
    }
}

// Source URLs for every family the download step will need to fetch — the state.json families
// (excluding curated duplicates) plus the 5 CJK regions for both sans and serif
const sources:Record<string, string[]> = {}
for (const family_name of new Set([...sans_included, ...serif_included])) {
    if (CURATED_DUPLICATES.has(family_name)) continue
    sources[family_name] = family_map.get(family_name)!.repo_paths.map(p => RAW_BASE + p)
}
for (const entry of [...CJK_SANS, ...CJK_SERIF]) {
    sources[entry.family] = entry.urls
    const manifest_entry = {family: entry.family, files: entry.files}
    if (entry.family.startsWith('Noto Serif')) serif_array.push(manifest_entry)
    else sans_array.push(manifest_entry)
}

// Curated duplicates are dropped from the arrays so get_noto_font() never shadows them
const manifest:NotoManifest = {
    sans: sans_array.filter(e => !CURATED_DUPLICATES.has(e.family)),
    serif: serif_array.filter(e => !CURATED_DUPLICATES.has(e.family)),
    by_script,
}

await writeFile(join(GENERATED_DIR, 'noto_manifest.json'), JSON.stringify(manifest, null, 4) + '\n')
await writeFile(join(GENERATED_DIR, 'noto_sources.json'), JSON.stringify(sources, null, 4) + '\n')
console.log(`\nGenerated ${join(GENERATED_DIR, 'noto_manifest.json')}`)
console.log(`Generated ${join(GENERATED_DIR, 'noto_sources.json')}`)
console.log(`  sans: ${manifest.sans.length} families`)
console.log(`  serif: ${manifest.serif.length} families`)
console.log(`  by_script: ${Object.keys(by_script).length} scripts`)
console.log(`  sources: ${Object.keys(sources).length} families`)
console.log('Done.')
