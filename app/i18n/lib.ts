
// Shared helpers for the paper.bible i18n tooling (extract / status / sync / check / migrate)

import {readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs'
import {join, dirname, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

// Paths (this file lives in <repo>/app/i18n/)
export const I18N_DIR = dirname(fileURLToPath(import.meta.url))
export const APP_DIR = join(I18N_DIR, '..')
export const REPO_ROOT = join(APP_DIR, '..')
export const SRC_DIR = join(APP_DIR, 'src')
export const LOCALES_DIR = join(SRC_DIR, 'locales')
export const STATE_DIR = join(LOCALES_DIR, '.state')
export const META_PATH = join(SRC_DIR, 'locales.json')

// Tooling side files (kept out of app/src/locales so Vite never bundles them)
export const CONTEXT_PATH = join(I18N_DIR, 'context.json')
export const GLOSSARY_PATH = join(I18N_DIR, 'glossary.json')
export const DYNAMIC_KEYS_PATH = join(I18N_DIR, 'dynamic_keys.json')

// The locale that source strings are authored in (its file holds the real English text)
export const SOURCE_LOCALE = 'eng'

// Shape of app/src/locales.json
interface LocalesMeta {
    source:string
    supported:string[]
}

// Read + parse locales.json (list of translation targets, excluding the source locale)
export function read_meta():LocalesMeta {
    const raw = JSON.parse(readFileSync(META_PATH, 'utf8')) as Partial<LocalesMeta>
    return {source: raw.source ?? SOURCE_LOCALE, supported: raw.supported ?? []}
}

// Prefixes of keys built at runtime (e.g. `${stem}.one`), which scan_usage() can't see.
// A key that starts with one of these counts as used.
export function read_dynamic_prefixes():string[] {
    if (!existsSync(DYNAMIC_KEYS_PATH)){
        return []
    }
    return JSON.parse(readFileSync(DYNAMIC_KEYS_PATH, 'utf8')) as string[]
}

// Keys defined in eng.json that no t()/$t() call references (dynamic-prefix keys excluded)
export function unused_keys(eng:Catalog, usage:Map<string, Set<string>>):string[] {
    const dynamic = read_dynamic_prefixes()
    return Object.keys(eng).filter(key => {
        return !usage.has(key) && !dynamic.some(prefix => key.startsWith(prefix))
    }).sort()
}

// A flat map of message key -> message text
export type Catalog = Record<string, string>

// Absolute path to a locale's catalog file
export function locale_path(locale:string):string {
    return join(LOCALES_DIR, `${locale}.json`)
}

// Absolute path to a locale's translation-base file (English text each entry was translated from)
export function base_path(locale:string):string {
    return join(STATE_DIR, `${locale}.json`)
}

// Read a JSON catalog, returning {} if the file does not exist yet
export function read_catalog(path:string):Catalog {
    if (!existsSync(path)){
        return {}
    }
    return JSON.parse(readFileSync(path, 'utf8')) as Catalog
}

// Write a catalog in canonical form: keys sorted, 2-space indent, trailing newline, LF endings
export function write_catalog(path:string, catalog:Catalog):void {
    const sorted:Catalog = {}
    for (const key of Object.keys(catalog).sort()){
        sorted[key] = catalog[key]!
    }
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
}

// True when the file already matches what write_catalog would produce (used by the CI check)
export function is_canonical(path:string):boolean {
    if (!existsSync(path)){
        return true
    }
    const current = readFileSync(path, 'utf8')
    const catalog = JSON.parse(current) as Catalog
    const sorted:Catalog = {}
    for (const key of Object.keys(catalog).sort()){
        sorted[key] = catalog[key]!
    }
    return current === JSON.stringify(sorted, null, 2) + '\n'
}

// Recursively collect .vue and .ts files under app/src (skips generated / vendor dirs)
export function source_files():string[] {
    const out:string[] = []
    // Walk the tree, ignoring anything that can't contain hand-written translation calls
    const skip = new Set(['node_modules', 'dist', 'locales'])
    const walk = (dir:string):void => {
        for (const entry of readdirSync(dir, {withFileTypes: true})){
            if (entry.name.startsWith('.') || skip.has(entry.name)){
                continue
            }
            const full = join(dir, entry.name)
            if (entry.isDirectory()){
                walk(full)
            } else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')){
                out.push(full)
            }
        }
    }
    walk(SRC_DIR)
    return out
}

// Matches a t(...) / $t(...) call opening with a string-literal first argument.
// Lookbehind rejects identifiers ending in "t" (emit, format, at, split, digest, ...).
// Group 1: the callee ("t" or "$t"). Group 2: quote char. Group 3: raw (still-escaped) literal.
export const CALL_RE = /(?<![\w.$])(\$?t)\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g

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

// One discovered translation call
export interface Usage {
    key:string
    file:string
}

// Scan all source files for translation calls, returning key -> set of repo-relative files
export function scan_usage():Map<string, Set<string>> {
    const usage = new Map<string, Set<string>>()
    // Check every source file for t()/$t() calls and record where each key is referenced
    for (const file of source_files()){
        const text = readFileSync(file, 'utf8')
        const rel = relative(REPO_ROOT, file)
        for (const match of text.matchAll(CALL_RE)){
            const key = unescape_literal(match[3]!)
            let files = usage.get(key)
            if (!files){
                files = new Set()
                usage.set(key, files)
            }
            files.add(rel)
        }
    }
    return usage
}

// Set difference: entries of a that are not in b
export function difference(a:string[], b:Set<string>):string[] {
    return a.filter(x => !b.has(x))
}

// Names of the {placeholder} tokens a message interpolates (matches translate() in services/i18n.ts)
export function arg_names(message:string):Set<string> {
    const names = new Set<string>()
    for (const match of message.matchAll(/\{(\w+)\}/g)){
        names.add(match[1]!)
    }
    return names
}

// How one target locale compares to the source catalog
export interface LocaleReport {
    locale:string
    missing:string[]   // in eng, absent from the locale
    stale:string[]     // present, but eng text changed since it was translated
    orphan:string[]    // in the locale, no longer in eng
}

// Compare a target locale (and its translation-base file) against the source catalog
export function analyse_locale(locale:string, eng:Catalog):LocaleReport {
    const target = read_catalog(locale_path(locale))
    const base = read_catalog(base_path(locale))
    const eng_keys = Object.keys(eng)
    const target_keys = new Set(Object.keys(target))
    return {
        locale,
        missing: eng_keys.filter(k => !target_keys.has(k)),
        stale: [...target_keys].filter(k => k in eng && base[k] !== eng[k]),
        orphan: [...target_keys].filter(k => !(k in eng)),
    }
}
