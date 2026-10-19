
// CI gate for translations. Exits non-zero on any of:
//  - user-visible text in app/src that never goes through t()/$t() (see lint.ts)
//  - a catalog / base file that is not in canonical form (run .bin/i18n_sync to fix)
//  - a key used in code but missing from eng.json, or a key in eng.json with no call site
//  - a locales.json entry that's malformed, or that browser detection could never pick
//  - a target locale that is missing keys, has orphan keys, or has stale entries
//  - a translation that would render wrong ({placeholders}, HTML tags, line breaks, keep-terms)
// Pass --warn-only to report without failing (for local use).
// Pass --allow-missing to not fail on untranslated keys (for locales still being filled in);
// everything else still fails.
// Usage: node app/i18n/check.ts [--warn-only] [--allow-missing]

import {existsSync} from 'node:fs'

import {
    SOURCE_LOCALE, SRC_DIR, read_meta, read_catalog, locale_path, base_path, is_canonical,
    analyse_locale, scan_usage, unused_keys, undefined_keys, read_glossary, translation_errors,
    rel,
} from './lib.ts'
import {find_untranslated} from './lint.ts'

// The app's own browser-tag mapping, so this checks exactly what detection will do. Loaded by
// path rather than imported, since the app's sources aren't part of the tooling's tsconfig
const {bcp47_to_locale, locale_to_bcp47} = await import(`${SRC_DIR}/services/locale.ts`) as {
    bcp47_to_locale:(tag:string) => string|null
    locale_to_bcp47:(locale:string) => string
}

const warn_only = process.argv.includes('--warn-only')
const allow_missing = process.argv.includes('--allow-missing')
const problems:string[] = []
let missing_count = 0
const note = (msg:string):void => {
    problems.push(msg)
}

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const meta = read_meta()
const glossary = read_glossary()

// 1. Text in the code that skips translation altogether
for (const finding of find_untranslated()){
    note(`untranslated text: ${finding.file}:${finding.line}  ${JSON.stringify(finding.text)}`
        + '  (wrap in $t(), single-quote it if not UI text, or mark it i18n-ignore)')
}

// 2. Canonical form of every catalog + base file
const files = [locale_path(SOURCE_LOCALE)]
for (const loc of meta.targets){
    files.push(locale_path(loc), base_path(loc))
}
for (const file of files){
    if (!is_canonical(file)){
        note(`not canonical: ${rel(file)} (run .bin/i18n_sync)`)
    }
}

// 3. Source keys vs. call sites
const usage = scan_usage()
for (const key of undefined_keys(eng, usage)){
    const sites = usage.get(key)!.map(site => `${site.file}:${site.line}`)
    note(`used but undefined: ${key}   [${sites.join(', ')}]`)
}
for (const key of unused_keys(eng, usage)){
    note(`defined but unused: ${key}`)
}

// 4. locales.json itself. A code must be the one detection maps the browser's tag to: browsers
// report the shortest tag for a language (CLDR's canonical form — "ar", never "arb"), so e.g.
// an "arb" entry would be unreachable while bcp47_to_locale() turns "ar" into "ara"
if (!(meta.source in meta.locales)){
    note(`locales.json: the source locale "${meta.source}" needs an entry of its own`)
}
for (const [code, info] of Object.entries(meta.locales)){
    if (!info.name || !info.english || !['ltr', 'rtl'].includes(info.dir)){
        note(`locales.json: "${code}" needs a name, an english name and a dir of ltr|rtl`)
    }
    let browser_tag = ''
    try {
        browser_tag = Intl.getCanonicalLocales(locale_to_bcp47(code))[0]!
    } catch {
        note(`locales.json: "${code}" isn't a valid language code`)
        continue
    }
    const detected = bcp47_to_locale(browser_tag)
    if (detected !== code){
        note(`locales.json: browsers report "${code}" as "${browser_tag}", which detection maps to`
            + ` "${detected}" — use that code, or map it in app/src/services/locale.ts`)
    }
    if (code !== meta.source && !existsSync(locale_path(code))){
        note(`${code}: no catalog yet (run .bin/i18n_job ${code})`)
    }
}

// 5. Per-locale coverage and whether each translation would render correctly
for (const loc of meta.targets){
    const target = read_catalog(locale_path(loc))
    const report = analyse_locale(loc, eng)
    missing_count += report.missing.length
    if (!allow_missing){
        for (const key of report.missing){
            note(`${loc} missing: ${key}`)
        }
    }
    for (const key of report.orphan){
        note(`${loc} orphan (not in ${SOURCE_LOCALE}): ${key}`)
    }
    for (const key of report.stale){
        note(`${loc} stale (English changed since translation): ${key}`)
    }
    for (const [key, message] of Object.entries(target)){
        if (key in eng){
            for (const error of translation_errors(eng[key]!, message, glossary)){
                note(`${loc} / ${key}: ${error}`)
            }
        }
    }
}

// Report
if (allow_missing && missing_count){
    console.log(`${missing_count} untranslated key(s) ignored (--allow-missing)\n`)
}
if (!problems.length){
    console.log(`i18n check passed (${Object.keys(eng).length} keys, `
        + `${meta.targets.length} target locale(s))`)
    process.exit(0)
}
console.log(`i18n check found ${problems.length} problem(s):`)
for (const p of problems){
    console.log(`  - ${p}`)
}
process.exit(warn_only ? 0 : 1)
