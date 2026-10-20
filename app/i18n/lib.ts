
// Shared helpers for the paper.bible i18n tooling (status / job / apply / sync / check / extract)
//
// Two catalog domains go through the same tooling:
//  - ui:  the app's interface, keyed by the UI locale detected from the browser
//         (app/src/locales/, listed in app/src/locales.json)
//  - doc: the few strings printed *into* a document (copyright page, chapter headings), keyed by
//         the fetch.bible language of the document's primary translation, since a book prints in
//         its Bible's language whatever language its creator's UI was in (typst/locales/, listed
//         in typst/locales.json, compiled into typst/src/generated/doc_strings.ts by gen_doc.ts)

import {readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs'
import {join, dirname, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

// Paths (this file lives in <repo>/app/i18n/)
export const I18N_DIR = dirname(fileURLToPath(import.meta.url))
export const APP_DIR = join(I18N_DIR, '..')
export const REPO_ROOT = join(APP_DIR, '..')
export const SRC_DIR = join(APP_DIR, 'src')
export const TYPST_DIR = join(REPO_ROOT, 'typst')

// Tooling side files (kept out of app/src/locales so Vite never bundles them)
export const CONTEXT_PATH = join(I18N_DIR, 'context.json')
export const GLOSSARY_PATH = join(I18N_DIR, 'glossary.json')
export const STYLE_DIR = join(I18N_DIR, 'style')
export const JOBS_DIR = join(I18N_DIR, 'jobs')

// A flat map of message key -> message text
export type Catalog = Record<string, string>

// One set of catalogs and where its strings are used
export interface Domain {
    name:'ui'|'doc'
    source:string  // The locale source strings are authored in (its file holds the real English)
    src_dir:string  // Scanned for call sites (the translator's context)
    locales_dir:string  // <code>.json catalogs, with .state/<code>.json translation bases
    meta_path:string  // locales.json: the source locale and every target's names + direction
}

// The two domains (see the top of this file)
export const DOMAINS:Record<Domain['name'], Domain> = {
    ui: {
        name: 'ui',
        source: 'en',
        src_dir: SRC_DIR,
        locales_dir: join(SRC_DIR, 'locales'),
        meta_path: join(SRC_DIR, 'locales.json'),
    },
    doc: {
        name: 'doc',
        source: 'eng',
        src_dir: join(TYPST_DIR, 'src'),
        locales_dir: join(TYPST_DIR, 'locales'),
        meta_path: join(TYPST_DIR, 'locales.json'),
    },
}

// The domains named by a --domain ui|doc argument, or both when it's absent
export function domains_from_args(args:string[]):Domain[] {
    const at = args.indexOf('--domain')
    if (at < 0){
        return [DOMAINS.ui, DOMAINS.doc]
    }
    const name = args[at + 1] as Domain['name']
    if (!(name in DOMAINS)){
        console.error(`--domain must be one of: ${Object.keys(DOMAINS).join(', ')}`)
        process.exit(1)
    }
    return [DOMAINS[name]]
}

// The positional arguments (locale codes / keys), skipping flags and the values they take
export function positional_args(args:string[], valued:string[] = []):string[] {
    return args.filter((arg, i) => !arg.startsWith('--') && !valued.includes(args[i - 1] ?? ''))
}

// One locale's entry in a locales.json (mirrors LocaleInfo in app/src/services/i18n.ts)
export interface LocaleInfo {
    name:string
    english:string
    dir:'ltr'|'rtl'
}

// Shape of a locales.json, plus the derived list of translation targets
export interface LocalesMeta {
    source:string
    locales:Record<string, LocaleInfo>
    targets:string[]  // Every locale but the source, i.e. the ones that get translated
}

// Read + parse a domain's locales.json
export function read_meta(domain:Domain):LocalesMeta {
    const raw = read_json<Partial<LocalesMeta>>(domain.meta_path, {})
    const source = raw.source ?? domain.source
    const locales = raw.locales ?? {}
    return {source, locales, targets: Object.keys(locales).filter(code => code !== source).sort()}
}

// Read a JSON file, returning `fallback` if it does not exist
export function read_json<T>(path:string, fallback:T):T {
    if (!existsSync(path)){
        return fallback
    }
    return JSON.parse(readFileSync(path, 'utf8')) as T
}

// Write JSON with 2-space indent and a trailing newline (keys left in the order given)
export function write_json(path:string, data:unknown):void {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

// Repo-relative form of a path, for messages
export function rel(path:string):string {
    return relative(REPO_ROOT, path)
}

// Hand-written translator notes, keyed by message key — only where the call site alone
// doesn't make the meaning clear (see context_for()). One file for both domains: doc keys all
// start with "doc.", so the two can never collide
export function read_context():Record<string, string> {
    return read_json<Record<string, string>>(CONTEXT_PATH, {})
}

// A glossary term: how to treat an English word wherever it appears (UI or document)
export interface GlossaryTerm {
    note:string
    keep?:boolean  // Must appear verbatim in every translation that contains it (names, URLs)
}

// The shared glossary (English terms -> guidance, the same for every locale)
export function read_glossary():Record<string, GlossaryTerm> {
    return read_json<Record<string, GlossaryTerm>>(GLOSSARY_PATH, {})
}

// Per-locale decisions the translator has made, carried from one batch to the next so a
// locale stays consistent however many sessions it's translated across. Shared by both domains
// (a code means the same language in each), so a Bible's printed wording matches its UI's
export interface LocaleStyle {
    notes?:string  // Register, formality, script, punctuation conventions etc.
    terms?:Record<string, string>  // Glossary term -> this locale's chosen rendering
}

// The written language a locale code names: its language, plus its script where that isn't the
// language's usual one ("de" for de/deu, "pt" for pt-BR/por, "zh-Hant" for cmn-Hant). The UI is
// keyed by browser tags and document strings by fetch.bible codes, so this is what lets both
// share one style file per written language
export function style_key(locale:string):string {
    const full = new Intl.Locale(locale).maximize()
    const usual = new Intl.Locale(full.language).maximize().script
    return full.script === usual ? full.language : `${full.language}-${full.script}`
}

// Absolute path to a locale's style file (shared by every locale code for that written language)
export function style_path(locale:string):string {
    return join(STYLE_DIR, `${style_key(locale)}.json`)
}

// Read a locale's style file ({} until the first batch is applied)
export function read_style(locale:string):LocaleStyle {
    return read_json<LocaleStyle>(style_path(locale), {})
}

// Keys defined in the source catalog that nothing references — no t()/$t() call and no mention
export function unused_keys(domain:Domain, eng:Catalog, usage:Map<string, Site[]>):string[] {
    const mentions = scan_mentions(domain, Object.keys(eng))
    return Object.keys(eng).filter(key => !usage.has(key) && !mentions.has(key)).sort()
}

// Keys used in code but missing from the source catalog
export function undefined_keys(eng:Catalog, usage:Map<string, Site[]>):string[] {
    return [...usage.keys()].filter(key => !(key in eng)).sort()
}

// Absolute path to a locale's catalog file
export function locale_path(domain:Domain, locale:string):string {
    return join(domain.locales_dir, `${locale}.json`)
}

// Absolute path to a locale's translation-base file (English text each entry was translated from)
export function base_path(domain:Domain, locale:string):string {
    return join(domain.locales_dir, '.state', `${locale}.json`)
}

// Read a JSON catalog, returning {} if the file does not exist yet
export function read_catalog(path:string):Catalog {
    return read_json<Catalog>(path, {})
}

// The canonical serialisation of a catalog: keys sorted, 2-space indent, trailing newline
function canonical(catalog:Catalog):string {
    const sorted:Catalog = {}
    for (const key of Object.keys(catalog).sort()){
        sorted[key] = catalog[key]!
    }
    return JSON.stringify(sorted, null, 2) + '\n'
}

// Write a catalog in canonical form
export function write_catalog(path:string, catalog:Catalog):void {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, canonical(catalog))
}

// True when the file already matches what write_catalog would produce (used by the CI check)
export function is_canonical(path:string):boolean {
    if (!existsSync(path)){
        return true
    }
    const current = readFileSync(path, 'utf8')
    return current === canonical(JSON.parse(current) as Catalog)
}

// Recursively collect a domain's .vue and .ts files (skips generated / vendor dirs)
export function source_files(domain:Domain):string[] {
    const out:string[] = []
    // Walk the tree, ignoring anything that can't contain hand-written translation calls
    // (generated/ holds the compiled doc catalogs, which name every key)
    const skip = new Set(['node_modules', 'dist', 'locales', 'generated'])
    const walk = (dir:string):void => {
        for (const entry of readdirSync(dir, {withFileTypes: true})){
            if (entry.name.startsWith('.') || skip.has(entry.name)){
                continue
            }
            const full = join(dir, entry.name)
            if (entry.isDirectory()){
                walk(full)
            } else if (entry.name.endsWith('.vue')
                    || (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))){
                out.push(full)
            }
        }
    }
    walk(domain.src_dir)
    return out
}

// Matches a t(...) / $t(...) / translate(...) call opening with a string-literal first argument.
// All three are real call forms: components use $t, helpers take a `t` argument, and services
// import translate() directly (see designs.ts). Lookbehind rejects identifiers ending in "t"
// (emit, format, at, split, digest, ...) and member calls like ctx.translate() on a canvas.
// Group 1: the callee. Group 2: quote char. Group 3: raw (still-escaped) literal.
export const CALL_RE =
    /(?<![\w.$])(translate|\$?t)\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g

// Turn a raw source literal into its actual string value (handles the escapes our messages use)
export function unescape_literal(raw:string):string {
    return raw.replace(/\\(['"`\\nrt])/g, (_, ch:string) => {
        if (ch === 'n'){
            return '\n'
        }
        if (ch === 'r'){
            return '\r'
        }
        if (ch === 't'){
            return '\t'
        }
        return ch
    })
}

// One place a key is referenced from
export interface Site {
    file:string  // Repo-relative
    line:number
    code:string  // The trimmed source line, which is most of what a translator needs to know
}

// Scan a domain's source files for translation calls, returning key -> every site referencing it
export function scan_usage(domain:Domain):Map<string, Site[]> {
    const usage = new Map<string, Site[]>()
    // Check every source file for t()/$t() calls and record where each key is referenced
    for (const file of source_files(domain)){
        const text = readFileSync(file, 'utf8')
        const lines = text.split('\n')
        for (const match of text.matchAll(CALL_RE)){
            const key = unescape_literal(match[3]!)
            const line = text.slice(0, match.index).split('\n').length
            let sites = usage.get(key)
            if (!sites){
                sites = []
                usage.set(key, sites)
            }
            sites.push({file: rel(file), line, code: lines[line - 1]!.trim()})
        }
    }
    return usage
}

// Keys named in the code without a t() call of their own: a quoted literal that is the key (a
// key passed around and translated later, e.g. walkthrough steps), or that the key is built from
// at runtime — a stem ('x.pages' for count_phrase's 'x.pages.one'/'.other'), or the start of a
// template (`x.title_${kind}`) or of a prefix test ('vuetify.'). Counts as usage, and is the
// only context a translator gets for such keys
export function scan_mentions(domain:Domain, keys:string[]):Map<string, Site[]> {
    const mentions = new Map<string, Site[]>()
    // A literal that looks like a key (or a key's stem/prefix), or a template's literal start
    const literal = /(['"])([a-z_][\w]*\.[\w.]*)\1|`([a-z_][\w]*\.[\w.]*)\$\{/g
    for (const file of source_files(domain)){
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((code, index) => {
            for (const match of code.matchAll(literal)){
                const named = match[2] ?? match[3]!
                const stem = /[._]$/.test(named) ? named : null
                for (const key of keys){
                    const hit = key === named || (stem ? key.startsWith(stem)
                        : key.startsWith(`${named}.`))
                    if (!hit){
                        continue
                    }
                    let sites = mentions.get(key)
                    if (!sites){
                        sites = []
                        mentions.set(key, sites)
                    }
                    sites.push({file: rel(file), line: index + 1, code: code.trim()})
                }
            }
        })
    }
    return mentions
}

// The context a translator gets for one key: where it's shown (up to a few call sites, as
// file:line plus the source line — or, for a key no call names, where it's mentioned) and any
// hand-written note
export function context_for(key:string, usage:Map<string, Site[]>, notes:Record<string, string>,
        mentions:Map<string, Site[]> = new Map()):{where:string[], note?:string} {
    const max_code = 160
    const sites = usage.get(key) ?? mentions.get(key) ?? []
    const where = sites.slice(0, 3).map(site => {
        const code = site.code.length > max_code ? site.code.slice(0, max_code) + '…' : site.code
        return `${site.file.replace(/^app\/src\//, '')}:${site.line}  ${code}`
    })
    const note = notes[key]
    return note ? {where, note} : {where}
}

// Set difference: entries of a that are not in b
export function difference(a:string[], b:Set<string>):string[] {
    return a.filter(x => !b.has(x))
}

// Names of the {placeholder} tokens a message interpolates (matches translate() in
// services/i18n.ts, and Vuetify's positional {0} for the vuetify.* keys)
export function arg_names(message:string):Set<string> {
    const names = new Set<string>()
    for (const match of message.matchAll(/\{(\w+)\}/g)){
        names.add(match[1]!)
    }
    return names
}

// HTML tags a message carries (a few are rendered with v-html), as a sorted list for comparison
function tags(message:string):string {
    return [...message.matchAll(/<\/?[a-z][^>]*>/gi)].map(match => match[0]).sort().join(' ')
}

// Problems that make a translation unusable — each one renders visibly wrong for the user, so
// the apply step refuses the entry and check fails on it
export function translation_errors(english:string, translated:unknown,
        glossary:Record<string, GlossaryTerm>):string[] {
    if (typeof translated !== 'string'){
        return ['not a string']
    }
    const errors:string[] = []
    if (!translated.trim() && english.trim()){
        errors.push('empty')
    }
    // Every {placeholder} in the English must survive translation, and no new ones appear
    const want = arg_names(english)
    const got = arg_names(translated)
    for (const name of want){
        if (!got.has(name)){
            errors.push(`missing placeholder {${name}}`)
        }
    }
    for (const name of got){
        if (!want.has(name)){
            errors.push(`unexpected placeholder {${name}} (placeholder names are never translated)`)
        }
    }
    if (tags(english) !== tags(translated)){
        errors.push('HTML tags differ from the English')
    }
    // Line breaks are layout (e.g. a two-line label), not wording
    if (english.split('\n').length !== translated.split('\n').length){
        errors.push('line count differs from the English')
    }
    for (const [term, info] of Object.entries(glossary)){
        if (info.keep && english.includes(term) && !translated.includes(term)){
            errors.push(`must keep "${term}" verbatim`)
        }
    }
    return errors
}

// Things worth a second look but not wrong in themselves (reported, never refused)
export function translation_warnings(english:string, translated:string, style:LocaleStyle,
        glossary:Record<string, GlossaryTerm> = {}):string[] {
    const warnings:string[] = []
    const letters = english.replace(/\{\w+\}/g, '').match(/\p{L}/gu)?.length ?? 0
    if (translated === english && letters > 3){
        warnings.push('identical to the English')
    }
    if (letters > 10 && (translated.length > english.length * 3
            || translated.length < english.length / 4)){
        warnings.push(`length ${translated.length} vs English ${english.length}`)
    }
    // Placeholder names aren't words of the sentence (`{binding}` is a value, not the term), and
    // a term inside a keep-term isn't one either ("Bible" in "Paper Bible")
    let wording = english.replace(/\{\w+\}/g, '')
    for (const [term, info] of Object.entries(glossary)){
        if (info.keep){
            wording = wording.replaceAll(term, '')
        }
    }
    for (const [term, rendering] of Object.entries(style.terms ?? {})){
        const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
        if (pattern.test(wording) && !translated.toLowerCase().includes(rendering.toLowerCase())){
            warnings.push(`glossary term "${term}" not rendered as "${rendering}"`)
        }
    }
    return warnings
}

// How one target locale compares to the source catalog
export interface LocaleReport {
    locale:string
    missing:string[]   // in eng, absent from the locale
    stale:string[]     // present, but eng text changed since it was translated
    orphan:string[]    // in the locale, no longer in eng
}

// Compare a target locale (and its translation-base file) against the source catalog
export function analyse_locale(domain:Domain, locale:string, eng:Catalog):LocaleReport {
    const target = read_catalog(locale_path(domain, locale))
    const base = read_catalog(base_path(domain, locale))
    const eng_keys = Object.keys(eng)
    const target_keys = new Set(Object.keys(target))
    return {
        locale,
        missing: eng_keys.filter(k => !target_keys.has(k)),
        stale: [...target_keys].filter(k => k in eng && base[k] !== eng[k]),
        orphan: [...target_keys].filter(k => !(k in eng)),
    }
}
