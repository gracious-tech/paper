
// Write a translation job per domain + locale: everything a translator (Claude) needs to
// translate that locale's outstanding strings, in one self-contained file — the English, where
// each string is used (call sites with their source line), hand-written notes, the glossary, and
// the locale's own earlier choices (style file). The translator only ever writes a flat
// {key: translation} file beside it, which .bin/i18n_apply validates and merges; catalogs are
// never edited by hand. See .claude/skills/translate/SKILL.md for the whole loop.
// Usage: node app/i18n/job.ts [locale ...] [--domain ui|doc] [--only prefix,...] [--review]
//            [--limit N]
//   locale ...  the locales to write jobs for (default: every target with anything to do)
//   --domain    only the UI catalogs, or only the document strings (default: both)
//   --only      only keys starting with one of these comma-separated prefixes (e.g. "common.")
//   --review    also include strings already translated and current, to re-check them. A
//               single pass (never batched, so it ends): narrow it with --only if it's large
//   --limit N   at most N strings per job (default 250); apply, then re-run for the rest

import {rmSync} from 'node:fs'
import {join} from 'node:path'

import {
    SOURCE_LOCALE, JOBS_DIR, read_meta, read_catalog, read_context, read_glossary, read_style,
    locale_path, base_path, analyse_locale, scan_usage, scan_mentions, context_for, write_json,
    rel, domains_from_args, positional_args,
} from './lib.ts'

import type {Domain, LocaleInfo, Catalog, Site} from './lib.ts'

// One string to translate
export interface JobString {
    en:string
    where:string[]
    note?:string
    was?:string  // The English the current translation was made from (stale entries only)
    current?:string  // The existing translation (stale entries, and every entry in --review)
}

// The job file's shape (read back by apply.ts)
export interface Job {
    domain:Domain['name']
    locale:string
    language:string
    dir:'ltr'|'rtl'
    output:string
    rules:string[]
    glossary:Record<string, {note:string, keep?:boolean, use?:string}>
    style:string|null
    strings:Record<string, JobString>
}

// What the strings of each domain are, for the translator
const BRIEF:Record<Domain['name'], string[]> = {
    ui: [
        'This is the UI of a web app for designing and printing Bibles. Translate the meaning '
            + 'for the context in "where" (component:line and the source line) and "note"; keep '
            + 'the register of each element — labels and buttons stay short, a button is an '
            + 'action.',
        'Keys under vuetify.* are the UI library\'s own strings (mostly screen-reader labels); '
            + 'their placeholders are positional, {0} and {1}.',
    ],
    doc: [
        'These strings are printed inside a Bible in this language — its copyright page and '
            + 'chapter headings — so use the formal register and conventions of published Bibles '
            + 'in this language (e.g. its usual word for a chapter heading). The copyright '
            + 'statements are licensing terms: translate them precisely, adding or softening '
            + 'nothing. "where" and "note" show how each is used.',
    ],
}

// The translation brief, repeated in every job so a job can be handed to any session as is
const RULES = [
    'Write the output file as one flat JSON object: {"<key>": "<translation>", ...}, covering '
        + 'every key in "strings" and nothing else (plus the optional "_style"/"_terms" below).',
    'Keep every {placeholder} exactly as written (never translate the name inside the braces); '
        + 'move it to wherever the grammar needs it. Keep HTML tags and line breaks as they are.',
    'Keys ending ".one" are shown for exactly 1 and ".other" for every other number. Write both, '
        + 'even if they come out identical in this language.',
    'Glossary terms marked "keep" appear verbatim. Otherwise use the "use" rendering where '
        + 'given; for a term with none, choose one and record it in "_terms": {"<term>": '
        + '"<rendering>"} so later batches stay consistent.',
    'An entry with "was" and "current" is stale: the English changed from "was" to "en". '
        + 'Revise "current" to match the new English (re-use it if still right).',
    'Use the "style" conventions. If there are none yet, decide them (formality, how the user '
        + 'is addressed, quotation marks, capitalisation of labels) and record them in "_style" '
        + 'as a short paragraph; only include "_style" when setting or changing it.',
]

const args = process.argv.slice(2)
const review = args.includes('--review')
const limit_at = args.indexOf('--limit')
const limit = limit_at >= 0 ? Number(args[limit_at + 1]) : review ? Infinity : 250
const only_at = args.indexOf('--only')
const only = only_at >= 0 ? (args[only_at + 1] ?? '').split(',').filter(Boolean) : []
const wanted = positional_args(args, ['--limit', '--only', '--domain'])
const domains = domains_from_args(args)
const notes = read_context()
const glossary = read_glossary()

// Refuse codes no domain lists, since nothing would ever load their catalog
for (const loc of wanted){
    if (!domains.some(domain => read_meta(domain).targets.includes(loc))){
        console.error(`"${loc}" is not a target locale — add it to app/src/locales.json (UI) `
            + 'and/or typst/locales.json (document strings) first')
        process.exit(1)
    }
}

let written = 0
for (const domain of domains){
    const meta = read_meta(domain)
    const locales = wanted.length ? wanted.filter(loc => meta.targets.includes(loc)) : meta.targets
    if (locales.length){
        written += write_jobs(domain, locales)
    }
}

if (written){
    console.log('\nTranslate each job into the "output" file it names, then run .bin/i18n_apply')
}


// Write (or clear) the jobs for one domain's locales, returning how many were written
function write_jobs(domain:Domain, locales:string[]):number {
    const meta = read_meta(domain)
    const eng = read_catalog(locale_path(domain, SOURCE_LOCALE))
    const usage = scan_usage(domain)
    const mentions = scan_mentions(domain, Object.keys(eng))
    let count = 0
    for (const loc of locales){
        count += write_job(domain, meta.locales[loc]!, loc, eng, usage, mentions) ? 1 : 0
    }
    return count
}


// Write one locale's job (or clear a finished one), returning whether there was anything to do
function write_job(domain:Domain, info:LocaleInfo, loc:string, eng:Catalog,
        usage:Map<string, Site[]>, mentions:Map<string, Site[]>):boolean {
    const report = analyse_locale(domain, loc, eng)
    const target = read_catalog(locale_path(domain, loc))
    const base = read_catalog(base_path(domain, loc))
    const style = read_style(loc)
    const job_path = join(JOBS_DIR, `${domain.name}.${loc}.json`)
    const out_path = join(JOBS_DIR, `${domain.name}.${loc}.out.json`)

    // Stale first (an existing translation is now wrong), then missing, then (--review) the rest
    const stale = new Set(report.stale)
    let todo = [...report.stale, ...report.missing]
    if (review){
        todo.push(...Object.keys(target).filter(key => key in eng && !stale.has(key)))
    }
    if (only.length){
        todo = todo.filter(key => only.some(prefix => key.startsWith(prefix)))
    }
    if (!todo.length){
        console.log(`${domain.name} ${loc}: nothing to translate`)
        rmSync(job_path, {force: true})
        return false
    }

    // Each batch is a contiguous run of keys in sorted order, so related strings (one
    // component's, one dialog's) are translated side by side
    const batch = todo.slice(0, limit).sort()
    const strings:Record<string, JobString> = {}
    for (const key of batch){
        const entry:JobString = {en: eng[key]!, ...context_for(key, usage, notes, mentions)}
        if (stale.has(key)){
            entry.was = base[key] ?? ''
        }
        if (target[key] !== undefined){
            entry.current = target[key]
        }
        strings[key] = entry
    }

    // The glossary, with this locale's chosen rendering beside each term it has decided
    const job_glossary:Job['glossary'] = {}
    for (const [term, guidance] of Object.entries(glossary)){
        const use = style.terms?.[term]
        job_glossary[term] = use ? {...guidance, use} : {...guidance}
    }

    const job:Job = {
        domain: domain.name,
        locale: loc,
        language: `${info.english} (${info.name})`,
        dir: info.dir,
        output: rel(out_path),
        rules: [...RULES.slice(0, 1), ...BRIEF[domain.name], ...RULES.slice(1)],
        glossary: job_glossary,
        style: style.notes ?? null,
        strings,
    }
    write_json(job_path, job)
    rmSync(out_path, {force: true})
    const remaining = todo.length - batch.length
    console.log(`${domain.name} ${loc}: ${batch.length} string(s) -> ${rel(job_path)}`
        + (remaining ? `  (${remaining} more after this batch)` : ''))
    return true
}
