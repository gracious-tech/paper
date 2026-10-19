
// Merge a translated job back into the catalogs. Reads app/i18n/jobs/<locale>.json (written by
// job.ts) and the translator's app/i18n/jobs/<locale>.out.json, then for every entry:
//  - refuses it if the key wasn't in the job, the English has changed since the job was
//    written, or it would render wrong (placeholders, HTML tags, line breaks, keep-terms)
//  - otherwise writes it to the locale's catalog and records the English it was translated
//    from in the base file — so it reads as current until that English changes again
// "_terms" / "_style" in the output update the locale's style file (app/i18n/style/).
// Both job files are deleted afterwards; anything refused or skipped is simply still missing
// (or stale) and comes back in the next job. Exits non-zero when anything was refused.
// Usage: node app/i18n/apply.ts [locale ...]   (default: every locale with an output file)

import {existsSync, readdirSync, rmSync} from 'node:fs'
import {join} from 'node:path'

import {
    SOURCE_LOCALE, JOBS_DIR, read_catalog, write_catalog, locale_path, base_path, read_json,
    write_json, read_glossary, read_style, style_path, translation_errors, translation_warnings,
    rel,
} from './lib.ts'

import type {Job} from './job.ts'

const wanted = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const locales = wanted.length ? wanted : (existsSync(JOBS_DIR) ? readdirSync(JOBS_DIR) : [])
    .filter(name => name.endsWith('.out.json')).map(name => name.slice(0, -'.out.json'.length))

if (!locales.length){
    console.log('no translated jobs to apply (expected app/i18n/jobs/<locale>.out.json)')
    process.exit(0)
}

const eng = read_catalog(locale_path(SOURCE_LOCALE))
const glossary = read_glossary()
let refused_total = 0

for (const loc of locales){
    const job_path = join(JOBS_DIR, `${loc}.json`)
    const out_path = join(JOBS_DIR, `${loc}.out.json`)
    if (!existsSync(job_path) || !existsSync(out_path)){
        console.log(`${loc}: needs both ${rel(job_path)} and ${rel(out_path)}`)
        refused_total++
        continue
    }
    const job = read_json<Job>(job_path, {} as Job)
    const out = read_json<Record<string, unknown>>(out_path, {})

    // The locale's style: decisions recorded in this batch apply to its own warnings too
    const style = read_style(loc)
    if (out['_terms'] && typeof out['_terms'] === 'object'){
        style.terms = {...style.terms, ...out['_terms'] as Record<string, string>}
    }
    if (typeof out['_style'] === 'string' && out['_style'].trim()){
        style.notes = out['_style'].trim()
    }

    const catalog = read_catalog(locale_path(loc))
    const base = read_catalog(base_path(loc))
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

    write_catalog(locale_path(loc), catalog)
    write_catalog(base_path(loc), base)
    if (style.notes || style.terms){
        write_json(style_path(loc), style)
    }
    rmSync(job_path)
    rmSync(out_path)

    // Report
    console.log(`${loc}: ${applied} applied, ${refused.length} refused, ${skipped.length} skipped`)
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

if (refused_total){
    console.log('\nRefused entries are still untranslated — run .bin/i18n_job again to redo them')
    process.exit(1)
}
