
// Merge a translated job back into the catalogs. Reads app/i18n/jobs/<domain>.<locale>.json
// (written by job.ts) and the translator's <domain>.<locale>.out.json beside it, then for every
// entry:
//  - refuses it if the key wasn't in the job, the English has changed since the job was
//    written, or it would render wrong (placeholders, HTML tags, line breaks, keep-terms)
//  - otherwise writes it to the locale's catalog and records the English it was translated
//    from in the base file — so it reads as current until that English changes again
// "_terms" / "_style" in the output update the locale's style file (app/i18n/style/), and
// document strings are recompiled into the typst package (gen_doc.ts).
// Both job files are deleted afterwards; anything refused or skipped is simply still missing
// (or stale) and comes back in the next job. Exits non-zero when anything was refused.
// Usage: node app/i18n/apply.ts [locale ...]   (default: every job with an output file)

import {existsSync, readdirSync, rmSync} from 'node:fs'
import {join} from 'node:path'

import {
    SOURCE_LOCALE, JOBS_DIR, DOMAINS, read_catalog, write_catalog, locale_path, base_path,
    read_json, write_json, read_glossary, read_style, style_path, translation_errors,
    translation_warnings, rel, positional_args,
} from './lib.ts'
import {write_doc_module} from './gen_doc.ts'

import type {Job} from './job.ts'

// Every finished job ("<domain>.<locale>"), narrowed to the locales asked for
const wanted = positional_args(process.argv.slice(2))
const jobs = (existsSync(JOBS_DIR) ? readdirSync(JOBS_DIR) : [])
    .filter(name => name.endsWith('.out.json'))
    .map(name => name.slice(0, -'.out.json'.length))
    .filter(name => !wanted.length || wanted.includes(name.split('.').slice(1).join('.')))

if (!jobs.length){
    console.log('no translated jobs to apply (expected app/i18n/jobs/<domain>.<locale>.out.json)')
    process.exit(0)
}

const glossary = read_glossary()
let refused_total = 0
let doc_changed = false

for (const name of jobs){
    const job_path = join(JOBS_DIR, `${name}.json`)
    const out_path = join(JOBS_DIR, `${name}.out.json`)
    if (!existsSync(job_path)){
        console.log(`${name}: no job file ${rel(job_path)} for this output`)
        refused_total++
        continue
    }
    const job = read_json<Job>(job_path, {} as Job)
    const out = read_json<Record<string, unknown>>(out_path, {})
    const domain = DOMAINS[job.domain]
    const loc = job.locale
    const eng = read_catalog(locale_path(domain, SOURCE_LOCALE))

    // The locale's style: decisions recorded in this batch apply to its own warnings too
    const style = read_style(loc)
    if (out['_terms'] && typeof out['_terms'] === 'object'){
        style.terms = {...style.terms, ...out['_terms'] as Record<string, string>}
    }
    if (typeof out['_style'] === 'string' && out['_style'].trim()){
        style.notes = out['_style'].trim()
    }

    const catalog = read_catalog(locale_path(domain, loc))
    const base = read_catalog(base_path(domain, loc))
    const refused:string[] = []
    const warned:string[] = []
    let applied = 0

    for (const [key, value] of Object.entries(out)){
        if (key === '_terms' || key === '_style'){
            continue
        }
        const entry = job.strings[key]
        if (!entry){
            refused.push(`${key}: not in this job`)
            continue
        }
        if (eng[key] !== entry.en){
            refused.push(`${key}: the English changed since the job was written`)
            continue
        }
        const errors = translation_errors(entry.en, value, glossary)
        if (errors.length){
            refused.push(`${key}: ${errors.join('; ')}`)
            continue
        }
        const translated = value as string
        for (const warning of translation_warnings(entry.en, translated, style, glossary)){
            warned.push(`${key}: ${warning}  ${JSON.stringify(translated)}`)
        }
        catalog[key] = translated
        base[key] = entry.en
        applied++
    }

    const skipped = Object.keys(job.strings).filter(key => !(key in out))

    write_catalog(locale_path(domain, loc), catalog)
    write_catalog(base_path(domain, loc), base)
    doc_changed ||= domain.name === 'doc' && applied > 0
    if (style.notes || style.terms){
        write_json(style_path(loc), style)
    }
    rmSync(job_path)
    rmSync(out_path)

    // Report
    console.log(`${domain.name} ${loc}: ${applied} applied, ${refused.length} refused, `
        + `${skipped.length} skipped`)
    for (const line of refused){
        console.log(`  ✗ ${line}`)
    }
    for (const line of warned){
        console.log(`  ? ${line}`)
    }
    if (skipped.length){
        console.log(`  (skipped keys come back in the next job: ${skipped.slice(0, 5).join(', ')}`
            + `${skipped.length > 5 ? ', …' : ''})`)
    }
    refused_total += refused.length
}

// The typst package carries the document strings compiled in, so rebuild that from the catalogs
if (doc_changed){
    write_doc_module()
    console.log('\nrecompiled the document strings into typst/src/generated/doc_strings.ts')
}

if (refused_total){
    console.log('\nRefused entries are still untranslated — run .bin/i18n_job again to redo them')
    process.exit(1)
}
