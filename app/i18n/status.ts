
// Report translation coverage: what each locale is missing, what has gone stale (English
// reworded since translation), what is orphaned, plus source-level problems (keys used in
// code but undefined, and defined keys nothing references).
// Usage: node app/i18n/status.ts [locale ...] [--json]

import {
    SOURCE_LOCALE, read_meta, read_catalog, locale_path, base_path, analyse_locale, scan_usage,
    unused_keys as find_unused,
} from './lib.ts'

const args = process.argv.slice(2)
const as_json = args.includes('--json')
const wanted = args.filter(a => !a.startsWith('--'))

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const meta = read_meta()
const locales = wanted.length ? wanted : meta.supported

// Source-level checks (independent of any one locale)
const usage = scan_usage()
const undefined_keys = [...usage.keys()].filter(k => !(k in eng)).sort()
const unused_keys = find_unused(eng, usage)

const reports = locales.map(loc => {
    const r = analyse_locale(loc, eng)
    const target = read_catalog(locale_path(loc))
    const total = Object.keys(eng).length
    const done = total - r.missing.length - r.stale.length
    return {...r, translated: Object.keys(target).length, coverage: done / total}
})

// JSON output for scripting
if (as_json){
    console.log(JSON.stringify({source: SOURCE_LOCALE, undefined_keys, unused_keys, reports}, null, 2))
    process.exit(0)
}

// Human output
console.log(`source ${SOURCE_LOCALE}: ${Object.keys(eng).length} keys\n`)

if (undefined_keys.length){
    console.log(`${undefined_keys.length} key(s) used in code but missing from ${SOURCE_LOCALE}.json:`)
    for (const k of undefined_keys){
        console.log(`  ! ${k}   [${[...usage.get(k)!].join(', ')}]`)
    }
    console.log()
}
if (unused_keys.length){
    console.log(`${unused_keys.length} key(s) in ${SOURCE_LOCALE}.json with no call site:`)
    for (const k of unused_keys){
        console.log(`  ? ${k}`)
    }
    console.log()
}

for (const r of reports){
    const pct = (r.coverage * 100).toFixed(1)
    console.log(`${r.locale}: ${pct}% (${r.translated} entries, `
        + `${r.missing.length} missing, ${r.stale.length} stale, ${r.orphan.length} orphan)`)
    const base = read_catalog(base_path(r.locale))
    for (const k of r.stale){
        console.log(`  ~ ${k}`)
        console.log(`      was: ${JSON.stringify(base[k] ?? '')}`)
        console.log(`      now: ${JSON.stringify(eng[k])}`)
    }
    for (const k of r.missing){
        console.log(`  + ${k}   ${JSON.stringify(eng[k])}`)
    }
    for (const k of r.orphan){
        console.log(`  - ${k}`)
    }
    console.log()
}
