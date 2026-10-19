
// Housekeeping for the locale files of both domains (see lib.ts). Safe to run any time:
//  - rewrites every eng.json, locale file and base file in canonical form
//    (keys sorted, 2-space indent, trailing newline)
//  - drops orphan keys (no longer in eng.json) from each locale and its base file
//  - drops base entries whose key is no longer translated
//  - recompiles the document strings into the typst package (gen_doc.ts)
//
// With --bless <key ...> it also marks those keys' existing translations as current for the
// English they now have, in every locale — for an English edit that doesn't change the meaning
// (a typo, punctuation), where retranslating would be wasted. Anything else goes through
// .bin/i18n_job + .bin/i18n_apply, which record the base themselves.
// Usage: node app/i18n/sync.ts [--bless key ...]

import {
    SOURCE_LOCALE, DOMAINS, read_meta, read_catalog, write_catalog, locale_path, base_path,
    positional_args,
} from './lib.ts'
import {write_doc_module} from './gen_doc.ts'

import type {Domain} from './lib.ts'

const args = process.argv.slice(2)
const bless = args.includes('--bless')
const bless_keys = positional_args(args)
if (bless && !bless_keys.length){
    console.error('--bless needs the keys to bless (blessing everything would hide real staleness)')
    process.exit(1)
}

for (const domain of Object.values(DOMAINS)){
    sync_domain(domain)
}
write_doc_module()


// Canonicalise one domain's catalogs and drop what no longer belongs in them
function sync_domain(domain:Domain):void {
    const eng = read_catalog(locale_path(domain, SOURCE_LOCALE))
    write_catalog(locale_path(domain, SOURCE_LOCALE), eng)

    for (const loc of read_meta(domain).targets){
        const target = read_catalog(locale_path(domain, loc))
        const base = read_catalog(base_path(domain, loc))

        // Drop orphan translations and any stray base entries
        const clean_target:Record<string, string> = {}
        const clean_base:Record<string, string> = {}
        let orphans = 0
        for (const [key, value] of Object.entries(target)){
            if (!(key in eng)){
                orphans++
                continue
            }
            clean_target[key] = value
            if (base[key] !== undefined){
                clean_base[key] = base[key]!
            }
        }

        // Mark the named keys as translated from the current English
        let blessed = 0
        for (const key of bless_keys){
            if (clean_target[key] !== undefined && clean_base[key] !== eng[key]){
                clean_base[key] = eng[key]!
                blessed++
            }
        }

        write_catalog(locale_path(domain, loc), clean_target)
        write_catalog(base_path(domain, loc), clean_base)

        const missing = Object.keys(eng).filter(k => clean_target[k] === undefined).length
        console.log(`${domain.name} ${loc}: ${Object.keys(clean_target).length} entries, `
            + `${missing} missing`
            + (orphans ? `, ${orphans} orphan(s) removed` : '')
            + (bless ? `, ${blessed} blessed` : ''))
    }
}
