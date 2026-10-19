
// Report translation coverage: one line per locale (missing / stale / orphan), plus source-level
// problems (untranslated text in code, keys used but undefined, defined keys nothing uses).
// Kept short by default since there may be hundreds of locales; name locales (or pass --keys)
// to list the keys themselves.
// Usage: node app/i18n/status.ts [locale ...] [--keys] [--json]

import {
    SOURCE_LOCALE, read_meta, read_catalog, locale_path, base_path, analyse_locale, scan_usage,
    unused_keys, undefined_keys,
} from './lib.ts'
import {find_untranslated} from './lint.ts'

const args = process.argv.slice(2)
const as_json = args.includes('--json')
const wanted = args.filter(a => !a.startsWith('--'))
const show_keys = args.includes('--keys') || wanted.length > 0

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const meta = read_meta()
const locales = wanted.length ? wanted : meta.targets
const total = Object.keys(eng).length

// Source-level checks (independent of any one locale)
const usage = scan_usage()
const undefined_list = undefined_keys(eng, usage)
const unused_list = unused_keys(eng, usage)
const untranslated = find_untranslated()

const reports = locales.map(loc => {
    const r = analyse_locale(loc, eng)
    const done = total - r.missing.length - r.stale.length
    return {...r, coverage: done / total}
})

// JSON output for scripting
if (as_json){
    console.log(JSON.stringify({source: SOURCE_LOCALE, keys: total, untranslated,
        undefined_keys: undefined_list, unused_keys: unused_list, reports}, null, 2))
    process.exit(0)
}

// Source problems
console.log(`source ${SOURCE_LOCALE}: ${total} keys`)
for (const f of untranslated){
    console.log(`  ! untranslated text ${f.file}:${f.line}  ${JSON.stringify(f.text)}`)
}
for (const k of undefined_list){
    const sites = usage.get(k)!.map(site => `${site.file}:${site.line}`)
    console.log(`  ! used but undefined: ${k}   [${sites.join(', ')}]`)
}
for (const k of unused_list){
    console.log(`  ? defined but unused: ${k}`)
}
console.log()

// One line per locale, plus the keys themselves when asked
for (const r of reports){
    const pct = (r.coverage * 100).toFixed(1).padStart(5)
    const name = meta.locales[r.locale]?.english ?? '(not in locales.json)'
    console.log(`${r.locale}  ${pct}%  ${r.missing.length} missing, ${r.stale.length} stale, `
        + `${r.orphan.length} orphan  — ${name}`)
    if (!show_keys){
        continue
    }
    const base = read_catalog(base_path(r.locale))
    for (const k of r.stale){
        const was = JSON.stringify(base[k] ?? '')
        console.log(`    ~ ${k}   was ${was}, now ${JSON.stringify(eng[k])}`)
    }
    for (const k of r.missing){
        console.log(`    + ${k}   ${JSON.stringify(eng[k])}`)
    }
    for (const k of r.orphan){
        console.log(`    - ${k}`)
    }
}

const outstanding = reports.filter(r => r.missing.length || r.stale.length).map(r => r.locale)
if (outstanding.length){
    console.log(`\nTo translate what's outstanding: .bin/i18n_job ${outstanding.length > 8
        ? '' : outstanding.join(' ')}`.trimEnd())
}
