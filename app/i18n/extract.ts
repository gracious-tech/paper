
// Reconcile eng.json with the t()/$t() calls in the code.
//  - lists keys referenced in code but missing from eng.json (add these by hand, with the
//    English text and, ideally, a note in _context.json)
//  - lists keys in eng.json that nothing references any more
// With --prune it removes the unused keys from eng.json, every locale file and every base file.
// Usage: node app/i18n/extract.ts [--prune]

import {
    SOURCE_LOCALE, read_meta, read_catalog, write_catalog, locale_path, base_path, scan_usage,
    unused_keys as find_unused,
} from './lib.ts'

const prune = process.argv.includes('--prune')

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const usage = scan_usage()

const undefined_keys = [...usage.keys()].filter(k => !(k in eng)).sort()
const unused_keys = find_unused(eng, usage)

if (undefined_keys.length){
    console.log(`${undefined_keys.length} key(s) used in code but missing from ${SOURCE_LOCALE}.json:`)
    for (const key of undefined_keys){
        console.log(`  ${key}   [${[...usage.get(key)!].join(', ')}]`)
    }
} else {
    console.log(`no undefined keys — every t()/$t() call resolves`)
}

console.log()

if (!unused_keys.length){
    console.log(`no unused keys — every ${SOURCE_LOCALE}.json entry has a call site`)
    process.exit(0)
}

console.log(`${unused_keys.length} key(s) in ${SOURCE_LOCALE}.json with no call site:`)
for (const key of unused_keys){
    console.log(`  ${key}`)
}

if (!prune){
    console.log(`\nre-run with --prune to remove them from ${SOURCE_LOCALE}.json and all locales`)
    process.exit(0)
}

// Prune unused keys everywhere
const drop = new Set(unused_keys)
const meta = read_meta()
for (const path of [locale_path(SOURCE_LOCALE),
        ...meta.supported.flatMap(l => [locale_path(l), base_path(l)])]){
    const catalog = read_catalog(path)
    let removed = 0
    for (const key of Object.keys(catalog)){
        if (drop.has(key)){
            delete catalog[key]
            removed++
        }
    }
    if (removed){
        write_catalog(path, catalog)
        console.log(`  pruned ${removed} from ${path.replace(/.*\/app\/src\//, 'app/src/')}`)
    }
}
