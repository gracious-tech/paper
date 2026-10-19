
// Write a translation job per locale: everything a translator (Claude) needs to translate that
// locale's outstanding strings, in one self-contained file — the English, where each string is
// shown (call sites with their source line), hand-written notes, the glossary, and the locale's
// own earlier choices (style file). The translator only ever writes a flat {key: translation}
// file beside it, which .bin/i18n_apply validates and merges; catalogs are never edited by hand.
// See .claude/skills/translate/SKILL.md for the whole loop.
// Usage: node app/i18n/job.ts [locale ...] [--only prefix,...] [--review] [--limit N]
//   locale ...  the locales to write jobs for (default: every target with anything to do)
//   --only      only keys starting with one of these comma-separated prefixes (e.g. "common.")
//   --review    also include strings already translated and current, to re-check them. A
//               single pass (never batched, so it ends): narrow it with --only if it's large
//   --limit N   at most N strings per job (default 250); apply, then re-run for the rest

import {rmSync} from 'node:fs'
import {join} from 'node:path'

import {
    SOURCE_LOCALE, JOBS_DIR, read_meta, read_catalog, read_context, read_glossary, read_style,
    locale_path, base_path, analyse_locale, scan_usage, scan_mentions, context_for, write_json,
    rel,
} from './lib.ts'

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
    locale:string
    language:string
    dir:'ltr'|'rtl'
    output:string
    rules:string[]
    glossary:Record<string, {note:string, keep?:boolean, use?:string}>
    style:string|null
    strings:Record<string, JobString>
}

// The translation brief, repeated in every job so a job can be handed to any session as is
const RULES = [
    'Write the output file as one flat JSON object: {"<key>": "<translation>", ...}, covering '
        + 'every key in "strings" and nothing else (plus the optional "_style"/"_terms" below).',
    'This is the UI of a web app for designing and printing Bibles. Translate the meaning for '
        + 'the context in "where" (component:line and the source line) and "note"; keep the '
        + 'register of each element — labels and buttons stay short, a button is an action.',
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
    'Keys under vuetify.* are the UI library\'s own strings (mostly screen-reader labels); '
        + 'their placeholders are positional, {0} and {1}.',
]

const args = process.argv.slice(2)
const review = args.includes('--review')
const limit_at = args.indexOf('--limit')
const limit = limit_at >= 0 ? Number(args[limit_at + 1]) : review ? Infinity : 250
const only_at = args.indexOf('--only')
const only = only_at >= 0 ? (args[only_at + 1] ?? '').split(',').filter(Boolean) : []
const wanted = args.filter((arg, i) => !arg.startsWith('--')
    && args[i - 1] !== '--limit' && args[i - 1] !== '--only')

const meta = read_meta()
const eng = read_catalog(locale_path(SOURCE_LOCALE))
const usage = scan_usage()
const mentions = scan_mentions(Object.keys(eng))
const notes = read_context()
const glossary = read_glossary()

// Refuse codes that aren't in locales.json, since nothing would ever load their catalog
for (const loc of wanted){
    if (!meta.targets.includes(loc)){
        console.error(`"${loc}" is not a target locale — add it to app/src/locales.json first`)
        process.exit(1)
    }
}

let written = 0
for (const loc of wanted.length ? wanted : meta.targets){
    const report = analyse_locale(loc, eng)
    const target = read_catalog(locale_path(loc))
    const base = read_catalog(base_path(loc))
    const style = read_style(loc)
    const job_path = join(JOBS_DIR, `${loc}.json`)
    const out_path = join(JOBS_DIR, `${loc}.out.json`)

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
        console.log(`${loc}: nothing to translate`)
        rmSync(job_path, {force: true})
        continue
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
    for (const [term, info] of Object.entries(glossary)){
        const use = style.terms?.[term]
        job_glossary[term] = use ? {...info, use} : {...info}
    }

    const info = meta.locales[loc]!
    const job:Job = {
        locale: loc,
        language: `${info.english} (${info.name})`,
        dir: info.dir,
        output: rel(out_path),
        rules: RULES,
        glossary: job_glossary,
        style: style.notes ?? null,
        strings,
    }
    write_json(job_path, job)
    rmSync(out_path, {force: true})
    written++
    const remaining = todo.length - batch.length
    console.log(`${loc}: ${batch.length} string(s) -> ${rel(job_path)}`
        + (remaining ? `  (${remaining} more after this batch)` : ''))
}

if (written){
    console.log('\nTranslate each job into the "output" file it names, then run .bin/i18n_apply')
}
