
import {execFileSync} from 'node:child_process'

import {load_issues, save_issues} from './store.ts'

import type {ErrorRecord} from '../server/src/errors.ts'
import type {Issue} from './store.ts'


// The AI clustering layer: the bucket fingerprint only collapses literal repeats, so claude
// decides which fingerprints are the same underlying bug (JS error wording varies per browser)


function build_prompt(existing:Record<string, Issue>,
        samples:{fingerprint:string, count:number, record:ErrorRecord}[]):string{
    // Compose the classification prompt: existing issues to extend + one sample per fingerprint
    const issue_lines = Object.entries(existing).map(([id, issue]) => {
        return `- ${id}: ${issue.summary}`
    })
    const sample_blocks = samples.map(sample => {
        return [
            `### Fingerprint ${sample.fingerprint} (${sample.count} occurrence(s))`,
            '```json',
            JSON.stringify({
                source: sample.record.source,
                severity: sample.record.severity,
                url: sample.record.url,
                user_agent: sample.record.user_agent,
                message: sample.record.message.slice(0, 2000),
            }, undefined, 4),
            '```',
        ].join('\n')
    })
    return [
        'You are triaging error reports for this web app (a Vue SPA + Cloud Run server that',
        'compiles Bible PDFs with Typst). Each fingerprint below groups byte-identical error',
        'messages; your job is the semantic layer: cluster fingerprints that are the same',
        'underlying bug into "issues" (browsers word the same error differently).',
        '',
        'Existing issues (reuse their id to add fingerprints to them):',
        issue_lines.length ? issue_lines.join('\n') : '(none yet)',
        '',
        'New fingerprints to classify:',
        '',
        sample_blocks.join('\n\n'),
        '',
        'Assign EVERY new fingerprint to exactly one issue (existing or new). For new issues',
        'invent a short kebab-case id, a one-line summary, the likely cause, and any suspected',
        'files in this repository (inspect the code if helpful).',
        '',
        'Respond with ONLY this JSON (no markdown fences, no other text):',
        '{"issues": [{"id": "kebab-case-id", "summary": "...", "cause": "...",',
        ' "files": ["path/one.ts"], "fingerprints": ["abc123def456"]}]}',
    ].join('\n')
}


function parse_response(output:string):{id:string, summary?:string, cause?:string,
        files?:string[], fingerprints?:string[]}[]{
    // Extract the JSON object from claude's reply (tolerating stray text/fences around it)
    const start = output.indexOf('{')
    const end = output.lastIndexOf('}')
    if (start === -1 || end <= start){
        throw new Error('No JSON found in claude output')
    }
    const data = JSON.parse(output.slice(start, end + 1)) as {issues?:unknown}
    if (!Array.isArray(data.issues)){
        throw new Error('Malformed claude output (no issues array)')
    }
    return data.issues as ReturnType<typeof parse_response>
}


export function classify_new_fingerprints(records:Map<string, ErrorRecord[]>):void{
    // Ask claude to assign fingerprints not yet in any issue, then merge into issues.json
    // Failures are non-fatal — unclassified fingerprints just show as their own TUI rows
    const issues = load_issues()
    const assigned = new Set(Object.values(issues).flatMap(issue => issue.fingerprints))
    const unassigned = [...records.keys()].filter(fp => !assigned.has(fp))
    if (!unassigned.length){
        return
    }

    // One representative (newest) record per fingerprint, IP never included
    const samples = unassigned.map(fp => {
        const items = records.get(fp)!
        return {fingerprint: fp, count: items.length, record: items[0]!}
    })

    console.log(`Analysing ${unassigned.length} new error group(s) with claude...`)
    let output = ''
    try {
        output = execFileSync('claude', ['-p', build_prompt(issues, samples)],
            {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000})
    } catch (error){
        console.error('claude analysis failed (groups will show unclassified):',
            error instanceof Error ? error.message : error)
        return
    }

    // Merge, only ever assigning fingerprints that were actually pending classification
    try {
        const pending = new Set(unassigned)
        for (const entry of parse_response(output)){
            const fingerprints = (entry.fingerprints ?? []).filter(fp => pending.has(fp))
            if (!fingerprints.length){
                continue
            }
            const existing = issues[entry.id]
            if (existing){
                existing.fingerprints.push(...fingerprints)
            } else {
                issues[entry.id] = {
                    summary: entry.summary ?? '(no summary)',
                    cause: entry.cause ?? '',
                    files: entry.files ?? [],
                    fingerprints,
                }
            }
            fingerprints.forEach(fp => pending.delete(fp))
        }
        save_issues(issues)
        if (pending.size){
            console.warn(`claude left ${pending.size} fingerprint(s) unclassified`)
        }
    } catch (error){
        console.error('Could not parse claude output (groups will show unclassified):',
            error instanceof Error ? error.message : error)
    }
}
