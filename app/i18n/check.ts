
// CI gate for translations. Exits non-zero on any of:
//  - a catalog / base file that is not in canonical form (run app/i18n/sync.ts to fix)
//  - a key used in code but missing from eng.json
//  - a key in eng.json with no call site
//  - a target locale that is missing keys, has orphan keys, or has stale entries
//  - a {placeholder} mismatch between a translation and its English source
// Pass --warn-only to report without failing (for local use).
// Pass --allow-missing to not fail on untranslated keys (for locales still being filled in);
// stale, orphan, undefined, unused, non-canonical and placeholder errors still fail.
// Usage: node app/i18n/check.ts [--warn-only] [--allow-missing]

import {
    SOURCE_LOCALE, read_meta, read_catalog, locale_path, base_path, is_canonical,
    analyse_locale, scan_usage, arg_names, unused_keys,
} from './lib.ts'

const warn_only = process.argv.includes('--warn-only')
const allow_missing = process.argv.includes('--allow-missing')
const problems:string[] = []
const missing_notes:string[] = []
const note = (msg:string):void => {
    problems.push(msg)
}

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const meta = read_meta()

// 1. Canonical form of every catalog + base file
const files = [locale_path(SOURCE_LOCALE)]
for (const loc of meta.supported){
    files.push(locale_path(loc), base_path(loc))
}
for (const file of files){
    if (!is_canonical(file)){
        note(`not canonical: ${file.replace(/.*\/app\/src\//, 'app/src/')} (run app/i18n/sync.ts)`)
    }
}

// 2. Source keys vs. call sites
const usage = scan_usage()
for (const key of [...usage.keys()].sort()){
    if (!(key in eng)){
        note(`used but undefined: ${key}   [${[...usage.get(key)!].join(', ')}]`)
    }
}
for (const key of unused_keys(eng, usage)){
    note(`defined but unused: ${key}`)
}

// 3. Per-locale coverage + placeholder parity
for (const loc of meta.supported){
    const target = read_catalog(locale_path(loc))
    const report = analyse_locale(loc, eng)
    for (const key of report.missing){
        if (allow_missing){
            missing_notes.push(`${loc} missing: ${key}`)
        } else {
            note(`${loc} missing: ${key}`)
        }
    }
    for (const key of report.orphan){
        note(`${loc} orphan (not in ${SOURCE_LOCALE}): ${key}`)
    }
    for (const key of report.stale){
        note(`${loc} stale (English changed since translation): ${key}`)
    }
    // Every {placeholder} in the English must survive translation, and no new ones appear
    for (const [key, message] of Object.entries(target)){
        if (!(key in eng)){
            continue
        }
        const want = arg_names(eng[key]!)
        const got = arg_names(message)
        for (const name of want){
            if (!got.has(name)){
                note(`${loc} / ${key}: translation is missing placeholder {${name}}`)
            }
        }
        for (const name of got){
            if (!want.has(name)){
                note(`${loc} / ${key}: translation has unexpected placeholder {${name}}`)
            }
        }
    }
}

// Report
if (allow_missing && missing_notes.length){
    console.log(`${missing_notes.length} untranslated key(s) ignored (--allow-missing)\n`)
}
if (!problems.length){
    console.log(`i18n check passed (${Object.keys(eng).length} keys, `
        + `${meta.supported.length} locale(s))`)
    process.exit(0)
}
console.log(`i18n check found ${problems.length} problem(s):`)
for (const p of problems){
    console.log(`  - ${p}`)
}
process.exit(warn_only ? 0 : 1)
