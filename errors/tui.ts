
import {auto_fix} from './fix.ts'
import {resolve_commit} from './git.ts'
import {issue_prompt, write_prompt, update_triage, is_returned, needs_attention}
    from './store.ts'
import {make_terminal, print_wrapped, run_attached} from './terminal.ts'

import type {IssueStatus, IssueView, Priorities} from './store.ts'
import type {Terminal} from './terminal.ts'


// Interactive terminal triage of grouped errors


// What the list view is drawn from
export interface Snapshot {
    issues:IssueView[]
    priorities:Priorities|null
}

// Keys for picking a shortlisted issue straight into the automatic fixer
const SHORTLIST_KEYS = ['a', 'b', 'c']

// Fixed-width labels for each status
const STATUS_LABELS:Record<IssueStatus, string> = {
    new: 'NEW  ',
    deferred: 'LATER',
    fixed: 'FIXED',
    diagnosing: 'DIAG ',
    ignored: 'IGNOR',
}


function status_label(issue:IssueView):string{
    // A returned issue is labelled by why it's back rather than by its stored status
    if (is_returned(issue)){
        return issue.status === 'fixed' ? 'REGR ' : 'INFO '
    }
    return STATUS_LABELS[issue.status]
}


function print_list(snapshot:Snapshot, show_all:boolean):IssueView[]{
    // Render the list view, returning the rows in the order their numbers refer to
    const shown = show_all ? snapshot.issues : snapshot.issues.filter(needs_attention)
    console.log('')
    if (!shown.length){
        console.log('No error reports need attention \\o/')
    }
    for (const [index, issue] of shown.entries()){
        const severity = issue.critical ? 'CRIT ' : 'error'
        const count = String((issue.active.length || issue.records.length)).padStart(4)
        const ips = String(issue.ips).padStart(3)
        const columns = `${String(index + 1).padStart(3)}  ${status_label(issue)}  ${severity}`
            + `  ${count}x  ${ips} ip  ${issue.latest.slice(0, 10)}  `
        // A wrapped summary continues under itself, leaving the number column clear
        print_wrapped(columns + issue.summary, columns.length)
    }
    const hidden = snapshot.issues.length - shown.length
    if (hidden){
        console.log(`     (${hidden} fixed/ignored issue(s) hidden, h to show)`)
    }

    // Claude's picks, keyed for the automatic fixer
    const priorities = snapshot.priorities
    if (priorities?.shortlist.length){
        console.log('')
        console.log('Suggested next:')
        for (const [index, item] of priorities.shortlist.entries()){
            const issue = snapshot.issues.find(view => view.id === item.id)
            const number = issue && shown.includes(issue) ? `#${shown.indexOf(issue) + 1} ` : ''
            print_wrapped(`  ${SHORTLIST_KEYS[index]}  ${number}${issue?.summary ?? item.id}`, 5)
            print_wrapped(`       ${item.reason} (${item.impact}; fixability ${item.fixability})`,
                7)
        }
    }
    if (priorities?.noise.length){
        console.log('')
        print_wrapped(`Likely noise: ${priorities.noise.map(item => item.id).join(', ')}`, 4)
    }

    console.log('')
    const keys = priorities?.shortlist.length
        ? `${SHORTLIST_KEYS.slice(0, priorities.shortlist.length).join('/')} auto-fix suggestion, `
        : ''
    const noise = priorities?.noise.length ? 'i ignore noise, ' : ''
    print_wrapped(`Commands: ${keys}<number> open issue, ${noise}h show/hide fixed,`
        + ' r refresh from bucket, q quit', 4)
    return shown
}


function print_detail(issue:IssueView):void{
    // Render an issue's detail view (analysis, history and newest relevant report in full)
    console.log('')
    print_wrapped(`# ${issue.summary}`, 2)
    console.log('')
    if (issue.cause){
        print_wrapped(`Likely cause: ${issue.cause}`, 4)
    }
    if (issue.files.length){
        print_wrapped(`Suspected files: ${issue.files.join(', ')}`, 4)
    }
    if (issue.note){
        print_wrapped(`Note: ${issue.note}`, 4)
    }
    const commit = issue.commit ? ` at ${issue.commit.slice(0, 10)}` : ''
    print_wrapped(`Status: ${status_label(issue).trim()}${commit}   IPs: ${issue.ips}`
        + `   Fingerprints: ${issue.fingerprints.join(', ')}`, 4)
    if (issue.resolution){
        print_wrapped(`Resolution: ${issue.resolution}`, 4)
    }
    const filed = issue.records.length - issue.active.length
    console.log(`Reports: ${issue.active.length} need attention`
        + (filed ? `, ${filed} filed (older builds or ignored)` : ''))

    // Which builds reported it, most frequent first
    const builds = new Map<string, number>()
    for (const record of issue.records){
        const build = record.build ?? 'unstamped'
        builds.set(build, (builds.get(build) ?? 0) + 1)
    }
    print_wrapped(`Builds: ${[...builds].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([build, count]) => `${build} (${count})`).join(', ')}`, 4)

    console.log('')
    console.log('Latest report:')
    console.log(JSON.stringify(issue.active[0] ?? issue.records[0], undefined, 4))
    console.log('')
    print_wrapped('Commands: f auto-fix, c fix interactively with claude, x mark fixed, i ignore,'
        + ' l later, u reopen, n note, b back', 4)
}


async function detail_loop(term:Terminal, issue:IssueView):Promise<void>{
    // Handle actions on a single issue until the user goes back (or resolves it)
    print_detail(issue)
    while (true){
        const answer = (await term.ask('issue> ')).trim().toLowerCase()

        if (answer === 'b' || answer === 'q'){
            return

        } else if (answer === 'f'){
            await auto_fix(term, issue)
            return

        } else if (answer === 'c'){
            // Fix it in an interactive claude session, then return to the list once it exits
            const prompt = 'Please investigate and fix the following error reported by users of'
                + ` this app.\n\n${issue_prompt(issue)}`
            console.log(`Starting claude with the fix prompt (${write_prompt(issue, prompt)})...`)
            await run_attached(term.handoff, 'claude', [prompt])
            return

        } else if (answer === 'x'){
            // Pin to a fix made outside this tool
            const ref = (await term.ask('Fixed by which commit? [HEAD] ')).trim() || 'HEAD'
            const commit = resolve_commit(ref)
            if (!commit){
                console.log(`${ref} isn't a commit in this repository`)
                continue
            }
            update_triage(issue.id, {status: 'fixed', commit,
                resolved: new Date().toISOString()})
            console.log(`Marked fixed at ${commit.slice(0, 10)}`)
            return

        } else if (answer === 'i'){
            // Hidden for good; any further reports are filed under it silently
            update_triage(issue.id, {status: 'ignored'})
            console.log('Ignored')
            return

        } else if (answer === 'l'){
            // Defer — drops below new issues and out of claude's shortlist
            update_triage(issue.id, {status: 'deferred'})
            console.log('Marked for later')
            return

        } else if (answer === 'u'){
            // Back to new, forgetting any fix commit (so every report counts again)
            update_triage(issue.id, {status: 'new'})
            console.log('Reopened')
            return

        } else if (answer === 'n'){
            // Attach a free-text note (also given to claude when fixing/ranking)
            const note = (await term.ask('note> ')).trim()
            update_triage(issue.id, {note})
            issue.note = note
            console.log('Noted')

        } else {
            print_detail(issue)
        }
    }
}


async function ignore_noise(term:Terminal, snapshot:Snapshot):Promise<void>{
    // Ignore everything claude classed as noise in one go, keeping its reason as the note
    const noise = snapshot.priorities?.noise ?? []
    for (const item of noise){
        print_wrapped(`  ${item.id}: ${item.reason}`, 4)
    }
    const confirm = (await term.ask(`Ignore these ${noise.length} issue(s)? (y/N) `)).trim()
    if (confirm.toLowerCase() !== 'y'){
        return
    }
    for (const item of noise){
        const issue = snapshot.issues.find(view => view.id === item.id)
        update_triage(item.id, {status: 'ignored', note: issue?.note || `Noise: ${item.reason}`})
    }
    console.log('Ignored')
}


export async function run_tui(refresh:(download:boolean) => Promise<Snapshot>):Promise<void>{
    // Main loop: list issues, fix a suggestion or open an issue, act on it
    const term = make_terminal()
    let snapshot = await refresh(false)
    let show_all = false
    try {
        while (true){
            const shown = print_list(snapshot, show_all)
            const answer = (await term.ask('> ')).trim().toLowerCase()
            const shortlisted = snapshot.priorities?.shortlist[SHORTLIST_KEYS.indexOf(answer)]
            const index = Number(answer)

            if (answer === 'q'){
                return
            } else if (answer === 'r'){
                snapshot = await refresh(true)
            } else if (answer === 'h'){
                show_all = !show_all
            } else if (answer === 'i' && snapshot.priorities?.noise.length){
                await ignore_noise(term, snapshot)
                snapshot = await refresh(false)
            } else if (shortlisted){
                const issue = snapshot.issues.find(view => view.id === shortlisted.id)
                if (issue){
                    await auto_fix(term, issue)
                    snapshot = await refresh(false)
                }
            } else if (answer && Number.isInteger(index) && index >= 1 && index <= shown.length){
                await detail_loop(term, shown[index - 1]!)
                // Reassemble from local state (the issue may have been resolved/deferred)
                snapshot = await refresh(false)
            }
        }
    } finally {
        term.close()
    }
}

