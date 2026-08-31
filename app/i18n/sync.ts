
// Housekeeping for the locale files. Safe to run any time:
//  - rewrites eng.json, every locale file and every base file in canonical form
//    (keys sorted, 2-space indent, trailing newline)
//  - drops orphan keys (no longer in eng.json) from each locale and its base file
//  - drops base entries whose key is no longer translated
//
// With --bless it also records the current English as the translation base for keys that
// look translated (value differs from English), or for the specific keys passed after it.
// Run --bless straight after finishing a batch of translations so `status` shows them current.
// Usage: node app/i18n/sync.ts [--bless [key ...]]

import {
    SOURCE_LOCALE, read_meta, read_catalog, write_catalog, locale_path, base_path,
} from './lib.ts'

const args = process.argv.slice(2)
const bless = args.includes('--bless')
const bless_keys = args.filter(a => !a.startsWith('--'))

const eng = read_catalog(locale_path(SOURCE_LOCALE))
write_catalog(locale_path(SOURCE_LOCALE), eng)
const meta = read_meta()

for (const loc of meta.supported){
    const target = read_catalog(locale_path(loc))
    const base = read_catalog(base_path(loc))

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
        // Carry an existing base forward; --bless refreshes it (below)
        if (base[key] !== undefined){
            clean_base[key] = base[key]!
        }
    }

    // Optionally record the current English as the base for translated keys
    let blessed = 0
    if (bless){
        const targets = bless_keys.length ? bless_keys : Object.keys(clean_target)
        for (const key of targets){
            if (clean_target[key] === undefined){
                continue
            }
            if (bless_keys.length === 0 && clean_target[key] === eng[key]){
                // Skip entries that are still identical to English (not really translated)
                continue
            }
            if (clean_base[key] !== eng[key]){
                clean_base[key] = eng[key]!
                blessed++
            }
        }
    }

    write_catalog(locale_path(loc), clean_target)
    write_catalog(base_path(loc), clean_base)

    const missing = Object.keys(eng).filter(k => clean_target[k] === undefined).length
    console.log(`${loc}: ${Object.keys(clean_target).length} entries, ${missing} missing`
        + (orphans ? `, ${orphans} orphan(s) removed` : '')
        + (bless ? `, ${blessed} base(s) blessed` : ''))
}
