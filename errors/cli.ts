import {ensure_dirs, load_records, load_issues, load_triage, assemble_issues, list_brief,
    write_prompt, needs_attention, update_triage, log_action} from './store.ts'
import {decide_action, group_new_fingerprints, label_issues} from './analyse.ts'
import {resolve_bucket, sync_records} from './sync.ts'
import {build_includes} from './git.ts'
import {fix_issue} from './fix.ts'
import {repo_of} from './repos.ts'
import {spent_usd} from './claude.ts'

import type {Action} from './analyse.ts'


// Entry point (run via .bin/audit_errors), unattended from start to finish: move new error
// reports from the bucket to local storage, group new fingerprints into issues, have a no-tools
// model label the open ones, then act on each by a fixed policy (decide_action() in analyse.ts)
// and print a report built by this code alone, with no claude text in it


const assemble = () => assemble_issues(load_records(), load_issues(), load_triage(),
    build_includes)

ensure_dirs()
await sync_records(resolve_bucket(process.argv[2]))
group_new_fingerprints(load_records())
label_issues(assemble())

// Act on every issue needing attention, most important first
const report:{id:string, repo:string, action:Action, end?:string, commit?:string|null,
    reasons?:string[]}[] = []
let fixes = 0
for (const issue of assemble().filter(needs_attention)){
    const action = decide_action(issue, fixes, spent_usd())
    const repo = repo_of(issue).name
    if (action === 'clear_noise'){
        update_triage(issue.id, {cleared: new Date().toISOString()})
        log_action(issue.id, 'clear_noise')
        report.push({id: issue.id, repo, action})
    } else if (action === 'fix'){
        fixes += 1
        const outcome = await fix_issue(issue)
        if (outcome.end === 'no_change' && outcome.verdict === 'not_a_bug'){
            // Nothing here to change: file its reports, so only a recurrence brings it back
            update_triage(issue.id, {cleared: new Date().toISOString()})
        } else if (outcome.end !== 'committed'){
            update_triage(issue.id, {attempted: new Date().toISOString()})
        }
        report.push({id: issue.id, repo, action, end: outcome.end, commit: outcome.commit,
            reasons: outcome.reasons})
    } else {
        report.push({id: issue.id, repo, action})
    }
}

// The report, plus where a follow-up session starts
const brief_path = write_prompt('_brief', list_brief())
console.log(JSON.stringify({
    issues: report,
    // Unpushed, per repo: pushing either one deploys it
    committed: report.filter(entry => entry.end === 'committed')
        .map(entry => ({repo: entry.repo, commit: entry.commit})),
    spent_usd: Number(spent_usd().toFixed(2)),
    details: 'Each fix\'s outcome and patch: errors/records/prompts/<id>.fix.json and <id>.patch',
    follow_up: `For anything left, read ${brief_path} and use node errors/triage.ts`,
}, undefined, 4))
