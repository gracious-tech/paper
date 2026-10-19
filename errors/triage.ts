
import {ISSUE_STATUSES, load_records, load_issues, load_triage, assemble_issues, issue_prompt,
    update_triage} from './store.ts'
import {build_includes, resolve_commit} from './git.ts'

import type {IssueStatus} from './store.ts'


// Triage from the command line, for the claude session the TUI's list view opens (see
// list_prompt()). Run from the repo root, since the store's paths are relative to it


const USAGE = [
    'Usage:',
    '  node errors/triage.ts show <id>',
    '  node errors/triage.ts set <id> new|ignored',
    '  node errors/triage.ts set <id> fixed|diagnosing <commit>',
    '  node errors/triage.ts note <id> <text>',
].join('\n')


function fail(message:string):never{
    // Print an error (with usage) and exit
    console.error(`${message}\n\n${USAGE}`)
    process.exit(1)
}


// Resolve the issue first, so every command refuses an id that isn't in the list
const [command, id, ...rest] = process.argv.slice(2)
if (!command || !id){
    fail('Missing command or issue id')
}
const issue = assemble_issues(load_records(), load_issues(), load_triage(), build_includes)
    .find(view => view.id === id)
if (!issue){
    fail(`No issue with id ${id}`)
}

if (command === 'show'){
    console.log(issue_prompt(issue))

} else if (command === 'set'){
    // A fix or diagnostics status must name the commit it's pinned to
    const status = rest[0] as IssueStatus
    if (!ISSUE_STATUSES.includes(status)){
        fail(`Unknown status ${rest[0] ?? '(none)'}`)
    }
    if (status === 'fixed' || status === 'diagnosing'){
        const commit = resolve_commit(rest[1] ?? '')
        if (!commit){
            fail(`${rest[1] ?? '(none)'} isn't a commit in this repository`)
        }
        update_triage(id, {status, commit, resolved: new Date().toISOString()})
        console.log(`${id}: ${status} at ${commit.slice(0, 10)}`)
    } else {
        update_triage(id, {status})
        console.log(`${id}: ${status}`)
    }

} else if (command === 'note'){
    const note = rest.join(' ').trim()
    update_triage(id, {note})
    console.log(`${id}: note ${note ? 'set' : 'cleared'}`)

} else {
    fail(`Unknown command ${command}`)
}

