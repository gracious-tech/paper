
// Report translation coverage for both domains (see lib.ts): one line per locale (missing /
// stale / orphan), plus source-level problems (untranslated text in the app, keys used but
// undefined, defined keys nothing uses). Kept short by default since there may be hundreds of
// locales; name locales (or pass --keys) to list the keys themselves.
// Usage: node app/i18n/status.ts [locale ...] [--domain ui|doc] [--keys] [--json]

import {
    SOURCE_LOCALE, DOMAINS, read_meta, read_catalog, locale_path, base_path, analyse_locale,
    scan_usage, unused_keys, undefined_keys, domains_from_args, positional_args,
} from './lib.ts'
import {find_untranslated} from './lint.ts'

import type {Domain} from './lib.ts'

const args = process.argv.slice(2)
const as_json = args.includes('--json')
const wanted = positional_args(args, ['--domain'])
const show_keys = args.includes('--keys') || wanted.length > 0
const domains = domains_from_args(args)
const untranslated = domains.some(domain => domain.name === 'ui') ? find_untranslated() : []

const results = domains.map(domain => report(domain))

// JSON output for scripting
if (as_json){
    const domains_json = results.map(({domain, keys, undefined_keys, unused_keys, reports}) => {
        return {domain, keys, undefined_keys, unused_keys, reports}
    })
    console.log(JSON.stringify({source: SOURCE_LOCALE, untranslated, domains: domains_json},
        null, 2))
    process.exit(0)
}

for (const f of untranslated){
    console.log(`! untranslated text ${f.file}:${f.line}  ${JSON.stringify(f.text)}`)
}
const outstanding = new Set<string>()
for (const result of results){
    print(result)
    for (const r of result.reports){
        if (r.missing.length || r.stale.length){
            outstanding.add(r.locale)
        }
    }
}
if (outstanding.size){
    console.log(`\nTo translate what's outstanding: .bin/i18n_job ${outstanding.size > 8
        ? '' : [...outstanding].join(' ')}`.trimEnd())
}


// Gather one domain's source problems and per-locale coverage
function report(domain:Domain){
    const eng = read_catalog(locale_path(domain, SOURCE_LOCALE))
    const meta = read_meta(domain)
    const total = Object.keys(eng).length
    const usage = scan_usage(domain)
    const reports = (wanted.length ? wanted.filter(loc => meta.targets.includes(loc))
        : meta.targets).map(loc => {
        const r = analyse_locale(domain, loc, eng)
        return {...r, coverage: total ? (total - r.missing.length - r.stale.length) / total : 1}
    })
    return {domain: domain.name, keys: total, usage, eng, meta,
        undefined_keys: undefined_keys(eng, usage), unused_keys: unused_keys(domain, eng, usage),
        reports}
}


// Print one domain's report: source problems, then a line per locale (plus keys when asked)
function print(result:ReturnType<typeof report>):void {
    const domain = result.domain === 'ui' ? 'UI' : 'document strings'
    console.log(`\n${domain} (${result.domain}): ${result.keys} keys`)
    for (const k of result.undefined_keys){
        const sites = result.usage.get(k)!.map(site => `${site.file}:${site.line}`)
        console.log(`  ! used but undefined: ${k}   [${sites.join(', ')}]`)
    }
    for (const k of result.unused_keys){
        console.log(`  ? defined but unused: ${k}`)
    }
    for (const r of result.reports){
        const pct = (r.coverage * 100).toFixed(1).padStart(5)
        const name = result.meta.locales[r.locale]?.english ?? '(not in locales.json)'
        console.log(`  ${r.locale}  ${pct}%  ${r.missing.length} missing, ${r.stale.length} stale, `
            + `${r.orphan.length} orphan  — ${name}`)
        if (!show_keys){
            continue
        }
        const base = read_catalog(base_path(DOMAINS[result.domain], r.locale))
        for (const k of r.stale){
            const was = JSON.stringify(base[k] ?? '')
            console.log(`      ~ ${k}   was ${was}, now ${JSON.stringify(result.eng[k])}`)
        }
        for (const k of r.missing){
            console.log(`      + ${k}   ${JSON.stringify(result.eng[k])}`)
        }
        for (const k of r.orphan){
            console.log(`      - ${k}`)
        }
    }
}
