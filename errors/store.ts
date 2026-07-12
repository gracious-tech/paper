
import {mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'

import type {ErrorRecord} from '../server/src/errors.ts'


// Local mirror of the bucket's error records plus triage state, all under gitignored .errors/


export const ERRORS_DIR = '.errors'
export const RECORDS_DIR = join(ERRORS_DIR, 'records')
export const PROMPTS_DIR = join(ERRORS_DIR, 'prompts')
const ISSUES_PATH = join(ERRORS_DIR, 'issues.json')
const TRIAGE_PATH = join(ERRORS_DIR, 'triage.json')


// An AI-defined issue grouping one or more message fingerprints (the semantic layer the
// fingerprint hash deliberately doesn't attempt)
export interface Issue {
    summary:string
    cause:string
    files:string[]
    fingerprints:string[]
}

// Manual triage state for an issue
export interface IssueTriage {
    status:'new'|'deferred'
    note?:string
}

// An issue assembled with its records for display in the TUI
export interface IssueView {
    id:string
    summary:string
    cause:string
    files:string[]
    fingerprints:string[]
    records:ErrorRecord[]  // Newest first
    latest:string
    critical:boolean
    status:'new'|'deferred'
    note:string
}


export function ensure_dirs():void{
    // Make sure the .errors/ tree exists
    for (const dir of [ERRORS_DIR, RECORDS_DIR, PROMPTS_DIR]){
        mkdirSync(dir, {recursive: true})
    }
}


function list_dir(path:string):string[]{
    // Directory listing that tolerates the dir not existing yet
    try {
        return readdirSync(path)
    } catch {
        return []
    }
}


function load_json<T>(path:string, fallback:T):T{
    // Read a JSON file, returning the fallback if absent/corrupt
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
        return fallback
    }
}


export function local_object_names():Set<string>{
    // Object names (errors/{fp}/{id}.json) already downloaded into .errors/records/
    const names = new Set<string>()
    for (const fp of list_dir(RECORDS_DIR)){
        for (const file of list_dir(join(RECORDS_DIR, fp))){
            names.add(`errors/${fp}/${file}`)
        }
    }
    return names
}


export function save_record(object_name:string, contents:string):void{
    // Store a downloaded record at its bucket-mirroring local path
    const relative = object_name.slice('errors/'.length)  // {fp}/{id}.json
    const fp = relative.split('/')[0]!
    mkdirSync(join(RECORDS_DIR, fp), {recursive: true})
    writeFileSync(join(RECORDS_DIR, relative), contents)
}


export function load_records():Map<string, ErrorRecord[]>{
    // All local records keyed by fingerprint, newest first (corrupt files skipped)
    const records = new Map<string, ErrorRecord[]>()
    for (const fp of list_dir(RECORDS_DIR)){
        const items:ErrorRecord[] = []
        for (const file of list_dir(join(RECORDS_DIR, fp))){
            const record = load_json<ErrorRecord|null>(join(RECORDS_DIR, fp, file), null)
            if (record?.message !== undefined){
                items.push(record)
            }
        }
        if (items.length){
            items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            records.set(fp, items)
        }
    }
    return records
}


export function load_issues():Record<string, Issue>{
    // The AI-clustered issues (id → issue)
    return load_json(ISSUES_PATH, {})
}


export function save_issues(issues:Record<string, Issue>):void{
    // Persist the AI-clustered issues
    writeFileSync(ISSUES_PATH, JSON.stringify(issues, undefined, 4))
}


export function load_triage():Record<string, IssueTriage>{
    // Manual triage state (issue id → status/note)
    return load_json(TRIAGE_PATH, {})
}


export function save_triage(triage:Record<string, IssueTriage>):void{
    // Persist manual triage state
    writeFileSync(TRIAGE_PATH, JSON.stringify(triage, undefined, 4))
}


export function assemble_issues(records:Map<string, ErrorRecord[]>,
        issues:Record<string, Issue>, triage:Record<string, IssueTriage>):IssueView[]{
    // Merge AI issues + downloaded records + triage into display rows. Fingerprints claude
    // hasn't classified yet (e.g. analysis skipped/failed) appear as their own pseudo-issues
    const views:IssueView[] = []
    const classified = new Set<string>()

    // Real issues (skip fingerprints whose records were all deleted)
    for (const [id, issue] of Object.entries(issues)){
        issue.fingerprints.forEach(fp => classified.add(fp))
        const issue_records = issue.fingerprints.flatMap(fp => records.get(fp) ?? [])
        if (!issue_records.length){
            continue
        }
        issue_records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        views.push({
            id,
            summary: issue.summary,
            cause: issue.cause,
            files: issue.files,
            fingerprints: issue.fingerprints,
            records: issue_records,
            latest: issue_records[0]!.timestamp,
            critical: issue_records.some(record => record.severity === 'critical'),
            status: triage[id]?.status ?? 'new',
            note: triage[id]?.note ?? '',
        })
    }

    // Unclassified fingerprints
    for (const [fp, items] of records){
        if (classified.has(fp)){
            continue
        }
        const id = `fp:${fp}`
        views.push({
            id,
            summary: `(unclassified) ${items[0]!.message.split('\n')[0] ?? ''}`.slice(0, 100),
            cause: '',
            files: [],
            fingerprints: [fp],
            records: items,
            latest: items[0]!.timestamp,
            critical: items.some(record => record.severity === 'critical'),
            status: triage[id]?.status ?? 'new',
            note: triage[id]?.note ?? '',
        })
    }

    // Deferred last, then most occurrences first, then most recent first
    views.sort((a, b) => {
        if (a.status !== b.status){
            return a.status === 'deferred' ? 1 : -1
        }
        if (a.records.length !== b.records.length){
            return b.records.length - a.records.length
        }
        return b.latest.localeCompare(a.latest)
    })
    return views
}


export function write_prompt(issue:IssueView):string{
    // Write a ready-to-paste fix prompt for the issue, returning its path
    const lines = [
        'Please investigate and fix the following error reported by users of this app.',
        '',
        `Summary: ${issue.summary}`,
    ]
    if (issue.cause){
        lines.push(`Likely cause: ${issue.cause}`)
    }
    if (issue.files.length){
        lines.push(`Suspected files: ${issue.files.join(', ')}`)
    }
    if (issue.note){
        lines.push(`Triage note: ${issue.note}`)
    }
    lines.push(`Occurrences: ${issue.records.length} (latest ${issue.latest})`, '', '## Reports')

    // One report per fingerprint (the newest), capped — enough signal without flooding context
    const seen = new Set<string>()
    for (const record of issue.records){
        if (seen.has(record.fingerprint) || seen.size >= 5){
            continue
        }
        seen.add(record.fingerprint)
        lines.push('', '```json',
            JSON.stringify({...record, ip: undefined}, undefined, 4), '```')
    }

    const path = join(PROMPTS_DIR, `${issue.id.replace(/[^A-Za-z0-9_-]/g, '_')}.md`)
    mkdirSync(PROMPTS_DIR, {recursive: true})
    writeFileSync(path, lines.join('\n') + '\n')
    return path
}


export function remove_issue_local(issue:IssueView):void{
    // Remove an issue's local records, its issues.json entry, and its triage entry
    for (const fp of issue.fingerprints){
        rmSync(join(RECORDS_DIR, fp), {recursive: true, force: true})
    }
    const issues = load_issues()
    delete issues[issue.id]
    save_issues(issues)
    const triage = load_triage()
    delete triage[issue.id]
    save_triage(triage)
}
