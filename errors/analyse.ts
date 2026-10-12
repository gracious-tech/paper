
import {claude_structured} from './claude.ts'
import {load_issues, save_issues, load_priorities, save_priorities, is_returned}
    from './store.ts'
import {symbolicate} from './sourcemap.ts'

import type {ErrorRecord} from '../server/src/errors.ts'
import type {Issue, IssueView, Priorities} from './store.ts'


// The AI layers: clustering (the bucket fingerprint only collapses literal repeats, so claude
// decides which fingerprints are the same underlying bug — JS error wording varies per browser)
// and ranking (which open issues are worth fixing next, and which are noise)


// What the app is, for both prompts
const APP_CONTEXT = 'this web app (a Vue SPA + an API server on AWS Lambda that compiles Bible'
    + ' PDFs with Typst, in the browser via WASM or on the server as a fallback)'

// The classification answer's shape
const CLASSIFY_SCHEMA = {
    type: 'object',
    properties: {
        issues: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: {type: 'string'},
                    summary: {type: 'string'},
                    cause: {type: 'string'},
                    files: {type: 'array', items: {type: 'string'}},
                    fingerprints: {type: 'array', items: {type: 'string'}},
                },
                required: ['id', 'fingerprints'],
            },
        },
    },
    required: ['issues'],
}

// The ranking answer's shape
const RANK_SCHEMA = {
    type: 'object',
    properties: {
        shortlist: {
            type: 'array',
            maxItems: 3,
            items: {
                type: 'object',
                properties: {
                    id: {type: 'string'},
                    reason: {type: 'string'},
                    impact: {type: 'string'},
                    fixability: {type: 'string', enum: ['high', 'medium', 'low']},
                },
                required: ['id', 'reason', 'impact', 'fixability'],
            },
        },
        noise: {
            type: 'array',
            items: {
                type: 'object',
                properties: {id: {type: 'string'}, reason: {type: 'string'}},
                required: ['id', 'reason'],
            },
        },
    },
    required: ['shortlist', 'noise'],
}


function build_classify_prompt(existing:Record<string, Issue>,
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
                message: symbolicate(sample.record.message).slice(0, 3000),
            }, undefined, 4),
            '```',
        ].join('\n')
    })
    return [
        `You are triaging error reports for ${APP_CONTEXT}. Each fingerprint below groups`,
        'byte-identical error messages; your job is the semantic layer: cluster fingerprints',
        'that are the same underlying bug into "issues" (browsers word the same error',
        'differently).',
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
        'files in this repository (inspect the code if helpful). A message\'s trailing',
        '"Resolved source locations" section, when present, maps a minified stack frame to its',
        'original source file/line — prefer that over guessing from the minified position.',
    ].join('\n')
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
    let answer:{issues:{id:string, summary?:string, cause?:string, files?:string[],
        fingerprints:string[]}[]}
    try {
        answer = claude_structured(build_classify_prompt(issues, samples), CLASSIFY_SCHEMA)
    } catch (error){
        console.error('claude analysis failed (groups will show unclassified):',
            error instanceof Error ? error.message : error)
        return
    }

    // Merge, only ever assigning fingerprints that were actually pending classification
    const pending = new Set(unassigned)
    for (const entry of answer.issues){
        const fingerprints = entry.fingerprints.filter(fp => pending.has(fp))
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
}


function describe_candidate(issue:IssueView):string{
    // One issue's evidence for the ranking prompt (IPs never included, only their count)
    const reports = issue.active
    const builds = [...new Set(reports.map(record => record.build ?? 'unstamped'))]
    const agents = [...new Set(reports.map(record => record.user_agent ?? 'unknown'))]
    const state = !is_returned(issue) ? 'open'
        : issue.status === 'fixed' ? 'RETURNED: reported again by builds containing its fix'
        : 'reported again by builds carrying diagnostics added for it'
    return [
        `### ${issue.id}`,
        `State: ${state}`,
        `Summary: ${issue.summary}`,
        `Likely cause: ${issue.cause || '(unknown)'}`,
        `Suspected files: ${issue.files.join(', ') || '(none)'}`,
        `Reports: ${reports.length} from ${issue.ips} distinct IP(s), critical: ${issue.critical}`,
        `First/latest: ${reports.at(-1)!.timestamp} / ${issue.latest}`,
        `Builds: ${builds.slice(0, 5).join(', ')}`,
        `Browsers (${agents.length} distinct): ${agents.slice(0, 3).join(' | ').slice(0, 400)}`,
        issue.note ? `Developer's note: ${issue.note}` : '',
        'Newest message:',
        '```',
        symbolicate(reports[0]!.message).slice(0, 1500),
        '```',
    ].filter(line => line !== '').join('\n')
}


function build_rank_prompt(candidates:IssueView[]):string{
    // Compose the ranking prompt over every issue that currently needs a decision
    return [
        `You are prioritising the open error reports for ${APP_CONTEXT}. Its sole developer`,
        'will pick from your shortlist, and an AI agent will then attempt the fix in the',
        'background on this repository for them to review.',
        '',
        candidates.map(describe_candidate).join('\n\n'),
        '',
        'Pick a shortlist of up to 3 issues to work on next, best first. Weigh:',
        '- Impact: does it block the core job (designing, building or downloading a PDF,',
        '  signing in, keeping work) or is it cosmetic/recoverable? Severity "critical" means',
        '  the user was shown a failure splash',
        '- Reach: distinct IPs matter far more than raw counts (one user retrying inflates',
        '  counts)',
        '- Fixability from here: can the cause be found and verified from this code and these',
        '  reports, or does it need a particular device/browser to reproduce?',
        '- A RETURNED issue is a fix that did not hold, which deserves extra weight',
        '',
        'Separately list as noise the issues nothing in this codebase can or should fix:',
        'browser extensions or injected scripts, network blips/offline, devices out of memory,',
        'ancient or unsupported browsers, crawlers and bots. Never put an issue in both lists;',
        'issues in neither stay open for the developer. Use only the ids given above.',
        '',
        'For each shortlisted issue give a reason of at most 20 words (why this one now), the',
        'impact in at most 10 words (who/what is affected), and its fixability. For noise, a',
        'reason of at most 10 words.',
        'Judge from the evidence above; only glance at code if a call is genuinely unclear.',
    ].join('\n')
}


export function rank_issues(issues:IssueView[]):Priorities|null{
    // Claude's shortlist + noise list over the issues needing a decision (new or returned —
    // deferred ones were put aside deliberately). The cached ranking is reused, minus whatever
    // has since been dealt with, until an issue appears or gains reports; null if ranking failed
    const candidates = issues.filter(issue => issue.status === 'new' || is_returned(issue))
    const basis = Object.fromEntries(candidates.map(issue => [issue.id, issue.active.length]))
    if (!candidates.length){
        return {basis, shortlist: [], noise: []}
    }

    // Reuse the cache when every candidate was ranked with the same report count
    const cached = load_priorities()
    if (cached && candidates.every(issue => cached.basis[issue.id] === issue.active.length)){
        return {
            basis,
            shortlist: cached.shortlist.filter(item => item.id in basis),
            noise: cached.noise.filter(item => item.id in basis),
        }
    }

    console.log(`Ranking ${candidates.length} open issue(s) with claude...`)
    try {
        const answer = claude_structured<Omit<Priorities, 'basis'>>(
            build_rank_prompt(candidates), RANK_SCHEMA)
        const shortlist = answer.shortlist.filter(item => item.id in basis).slice(0, 3)
        const listed = new Set(shortlist.map(item => item.id))
        const noise = answer.noise.filter(item => item.id in basis && !listed.has(item.id))
        const priorities = {basis, shortlist, noise}
        save_priorities(priorities)
        return priorities
    } catch (error){
        console.error('claude ranking failed (no shortlist this time):',
            error instanceof Error ? error.message : error)
        return null
    }
}

