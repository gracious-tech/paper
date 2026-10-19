
// Reconcile each domain's eng.json with the t()/$t() calls in its code (see lib.ts).
//  - lists keys referenced in code but missing from eng.json (add these by hand, with the
//    English text and, where the call site alone is ambiguous, a note in context.json)
//  - lists keys in eng.json that nothing references any more
// With --prune it removes the unused keys from eng.json, every locale file and every base file.
// Usage: node app/i18n/extract.ts [--domain ui|doc] [--prune]

import {
    SOURCE_LOCALE, read_meta, read_catalog, write_catalog, locale_path, base_path, scan_usage,
    unused_keys, undefined_keys, domains_from_args, rel,
} from './lib.ts'
import {write_doc_module} from './gen_doc.ts'

import type {Domain} from './lib.ts'

const args = process.argv.slice(2)
const prune = args.includes('--prune')

let pruned_doc = false
for (const domain of domains_from_args(args)){
    pruned_doc ||= reconcile(domain) && domain.name === 'doc'
}
if (pruned_doc){
    write_doc_module()
}


// Report (and with --prune, remove) one domain's undefined and unused keys, returning whether
// anything was pruned
function reconcile(domain:Domain):boolean {
    const eng = read_catalog(locale_path(domain, SOURCE_LOCALE))
    const usage = scan_usage(domain)
    const undefined_list = undefined_keys(eng, usage)
    const unused_list = unused_keys(domain, eng, usage)
    const file = rel(locale_path(domain, SOURCE_LOCALE))

    console.log(`── ${domain.name}`)
    if (undefined_list.length){
        console.log(`${undefined_list.length} key(s) used in code but missing from ${file}:`)
        for (const key of undefined_list){
            const sites = usage.get(key)!.map(site => `${site.file}:${site.line}`)
            console.log(`  ${key}   [${sites.join(', ')}]`)
        }
    } else {
        console.log(`no undefined keys — every call resolves`)
    }

    if (!unused_list.length){
        console.log(`no unused keys — every ${file} entry has a call site\n`)
        return false
    }

    console.log(`${unused_list.length} key(s) in ${file} with no call site:`)
    for (const key of unused_list){
        console.log(`  ${key}`)
    }
    if (!prune){
        console.log(`re-run with --prune to remove them from ${file} and all its locales\n`)
        return false
    }

    // Prune unused keys from the source, every locale and every base file
    const drop = new Set(unused_list)
    const meta = read_meta(domain)
    for (const path of [locale_path(domain, SOURCE_LOCALE),
            ...meta.targets.flatMap(l => [locale_path(domain, l), base_path(domain, l)])]){
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
            console.log(`  pruned ${removed} from ${rel(path)}`)
        }
    }
    console.log()
    return true
}
