
// CI gate for translations, across both domains (see lib.ts). Exits non-zero on any of:
//  - user-visible text in app/src that never goes through t()/$t() (see lint.ts)
//  - a catalog / base file that is not in canonical form (run .bin/i18n_sync to fix)
//  - a key used in code but missing from the source catalog, or a source key with no call site
//  - a locales.json entry that's malformed, or a code in the wrong form for its domain
//  - a target locale that is missing keys, has orphan keys, or has stale entries
//  - a translation that would render wrong ({placeholders}, HTML tags, line breaks, keep-terms)
//  - typst/src/generated/doc_strings.ts out of date with the document catalogs
// Pass --warn-only to report without failing (for local use).
// Pass --allow-missing to not fail on untranslated keys (for locales still being filled in);
// everything else still fails.
// Usage: node app/i18n/check.ts [--warn-only] [--allow-missing]

import {existsSync} from 'node:fs'

import {
    DOMAINS, read_meta, read_catalog, locale_path, base_path,
    is_canonical, analyse_locale, scan_usage, unused_keys, undefined_keys, read_glossary,
    translation_errors, rel,
} from './lib.ts'
import {find_untranslated} from './lint.ts'
import {doc_module_current, DOC_MODULE_PATH} from './gen_doc.ts'

import type {Domain} from './lib.ts'

const warn_only = process.argv.includes('--warn-only')
const allow_missing = process.argv.includes('--allow-missing')
const problems:string[] = []
let missing_count = 0
const glossary = read_glossary()
const note = (msg:string):void => {
    problems.push(msg)
}

// Text in the app that skips translation altogether
for (const finding of find_untranslated()){
    note(`untranslated text: ${finding.file}:${finding.line}  ${JSON.stringify(finding.text)}`
        + '  (wrap in $t(), single-quote it if not UI text, or mark it i18n-ignore)')
}

// Everything else, per domain
for (const domain of Object.values(DOMAINS)){
    check_domain(domain)
}

// The typst package's compiled copy of the document strings
if (!doc_module_current()){
    note(`out of date: ${rel(DOC_MODULE_PATH)} (run .bin/i18n_sync)`)
}

// Report
if (allow_missing && missing_count){
    console.log(`${missing_count} untranslated key(s) ignored (--allow-missing)\n`)
}
if (!problems.length){
    const counts = Object.values(DOMAINS).map(domain => {
        const keys = Object.keys(read_catalog(locale_path(domain, domain.source))).length
        return `${domain.name}: ${keys} keys, ${read_meta(domain).targets.length} locale(s)`
    })
    console.log(`i18n check passed (${counts.join('; ')})`)
    process.exit(0)
}
console.log(`i18n check found ${problems.length} problem(s):`)
for (const p of problems){
    console.log(`  - ${p}`)
}
process.exit(warn_only ? 0 : 1)


// Check one domain's catalogs, call sites and locale list
function check_domain(domain:Domain):void {
    const eng = read_catalog(locale_path(domain, domain.source))
    const meta = read_meta(domain)
    const label = (loc:string) => `${domain.name} ${loc}`

    // Canonical form of every catalog + base file
    const files = [locale_path(domain, domain.source)]
    for (const loc of meta.targets){
        files.push(locale_path(domain, loc), base_path(domain, loc))
    }
    for (const file of files){
        if (!is_canonical(file)){
            note(`not canonical: ${rel(file)} (run .bin/i18n_sync)`)
        }
    }

    // Source keys vs. call sites
    const usage = scan_usage(domain)
    for (const key of undefined_keys(eng, usage)){
        const sites = usage.get(key)!.map(site => `${site.file}:${site.line}`)
        note(`used but undefined: ${key}   [${sites.join(', ')}]`)
    }
    for (const key of unused_keys(domain, eng, usage)){
        note(`defined but unused: ${key}`)
    }

    // locales.json itself
    if (!(meta.source in meta.locales)){
        note(`${rel(domain.meta_path)}: the source locale "${meta.source}" needs an entry too`)
    }
    for (const [code, info] of Object.entries(meta.locales)){
        if (!info.name || !info.english || !['ltr', 'rtl'].includes(info.dir)){
            note(`${rel(domain.meta_path)}: "${code}" needs a name, an english name and a dir`)
        }
        if (code !== meta.source && !existsSync(locale_path(domain, code))){
            note(`${label(code)}: no catalog yet (run .bin/i18n_job ${code})`)
        }
        if (domain.name === 'ui'){
            check_browser_tag(code)
        } else if (!/^[a-z]{3}(-[A-Z][a-z]{3})?$/.test(code)){
            // Document strings follow the Bible's language, as fetch.bible names it, plus its
            // script where fetch.bible declares one (see doc_language() in typst/src/doc_strings.ts)
            note(`${rel(domain.meta_path)}: "${code}" isn't a fetch.bible language code`
                + ' (ISO 639-3, optionally with an ISO 15924 script, e.g. cmn-Hant)')
        }
    }

    // Per-locale coverage and whether each translation would render correctly
    for (const loc of meta.targets){
        const target = read_catalog(locale_path(domain, loc))
        const report = analyse_locale(domain, loc, eng)
        missing_count += report.missing.length
        if (!allow_missing){
            for (const key of report.missing){
                note(`${label(loc)} missing: ${key}`)
            }
        }
        for (const key of report.orphan){
            note(`${label(loc)} orphan (not in ${domain.source}): ${key}`)
        }
        for (const key of report.stale){
            note(`${label(loc)} stale (English changed since translation): ${key}`)
        }
        for (const [key, message] of Object.entries(target)){
            if (key in eng){
                for (const error of translation_errors(eng[key]!, message, glossary)){
                    note(`${label(loc)} / ${key}: ${error}`)
                }
            }
        }
    }
}


// A UI locale code is a browser language tag, written the way browsers report it (CLDR's canonical
// form: "ar" not "arb", "zh-Hans" not "zh-hans"). Detection matches the browser's tags against
// these by language and script (see best_locale() in app/src/services/locale.ts), so any
// canonical tag is reachable, but a non-canonical one would never compare equal
function check_browser_tag(code:string):void {
    let canonical = ''
    try {
        canonical = Intl.getCanonicalLocales(code)[0]!
    } catch {
        note(`app/src/locales.json: "${code}" isn't a valid language tag`)
        return
    }
    if (canonical !== code){
        note(`app/src/locales.json: "${code}" should be written "${canonical}", as browsers report it`)
    }
}
