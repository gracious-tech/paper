
import {createInterface} from 'node:readline'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'

import {delete_object} from './bucket.ts'
import {write_prompt, remove_issue_local, load_triage, save_triage} from './store.ts'

import type {IssueView} from './store.ts'


// Interactive terminal triage of grouped errors


// Question prompt that buffers lines arriving between questions — plain readline.question()
// drops them, which breaks scripted/piped input (e.g. `printf '1\nf\nq\n' | .bin/errors ...`)
type Ask = (prompt:string) => Promise<string>

// Hands the terminal to a child process and back again (see run_claude())
interface TerminalHandoff {
    suspend:() => void
    resume:() => void
}

function make_ask():{ask:Ask, close:() => void, handoff:TerminalHandoff}{
    const rl = createInterface({input: process.stdin, output: process.stdout})
    const lines:string[] = []
    const waiters:((line:string) => void)[] = []
    let closed = false
    rl.on('line', line => {
        const waiter = waiters.shift()
        if (waiter){
            waiter(line)
        } else {
            lines.push(line)
        }
    })
    rl.on('close', () => {
        // EOF — answer any outstanding/future questions with 'q' so loops exit gracefully
        closed = true
        while (waiters.length){
            waiters.shift()!('q')
        }
    })
    const ask:Ask = prompt => {
        process.stdout.write(prompt)
        const line = lines.shift()
        if (line !== undefined){
            return Promise.resolve(line)
        }
        if (closed){
            return Promise.resolve('q')
        }
        return new Promise(resolve => {
            waiters.push(resolve)
        })
    }
    // Stop reading stdin (and leave raw mode) while a child owns the terminal, then restore
    // readline's raw mode afterwards since the child resets the TTY on its way out
    const handoff:TerminalHandoff = {
        suspend: () => {
            rl.pause()
            if (process.stdin.isTTY){
                process.stdin.setRawMode(false)
            }
        },
        resume: () => {
            if (process.stdin.isTTY){
                process.stdin.setRawMode(true)
            }
            rl.resume()
        },
    }
    return {ask, close: () => {rl.close()}, handoff}
}


async function run_claude(handoff:TerminalHandoff, prompt:string):Promise<void>{
    // Start an interactive claude session seeded with the prompt, returning once it exits
    handoff.suspend()
    // Ctrl+C reaches the whole process group, so ignore it here and let claude handle it
    const ignore_sigint = () => {}
    process.on('SIGINT', ignore_sigint)
    try {
        await new Promise<void>(resolve => {
            const child = spawn('claude', [prompt], {stdio: 'inherit'})
            child.on('error', error => {
                console.error(`Could not start claude: ${error.message}`)
                resolve()
            })
            child.on('exit', () => {
                resolve()
            })
        })
    } finally {
        process.off('SIGINT', ignore_sigint)
        handoff.resume()
    }
}


function print_list(issues:IssueView[]):void{
    // Render the issue list view
    console.log('')
    if (!issues.length){
        console.log('No error reports \\o/')
    }
    for (const [index, issue] of issues.entries()){
        const status = issue.status === 'deferred' ? 'LATER' : 'NEW  '
        const severity = issue.critical ? 'CRIT ' : 'error'
        const latest = issue.latest.slice(0, 10)
        const count = String(issue.records.length).padStart(4)
        const ips = String(issue.ips).padStart(3)
        console.log(`${String(index + 1).padStart(3)}  ${status}  ${severity}  ${count}x`
            + `  ${ips} ip  ${latest}  ${issue.summary.slice(0, 90)}`)
    }
    console.log('')
    console.log('Commands: <number> open issue, r refresh from bucket, q quit')
}


function print_detail(issue:IssueView):void{
    // Render an issue's detail view (analysis + newest report in full)
    console.log('')
    console.log(`# ${issue.summary}`)
    console.log('')
    if (issue.cause){
        console.log(`Likely cause: ${issue.cause}`)
    }
    if (issue.files.length){
        console.log(`Suspected files: ${issue.files.join(', ')}`)
    }
    if (issue.note){
        console.log(`Note: ${issue.note}`)
    }
    console.log(`Status: ${issue.status}   Occurrences: ${issue.records.length}`
        + `   IPs: ${issue.ips}   Fingerprints: ${issue.fingerprints.join(', ')}`)
    console.log('')
    console.log('Latest report:')
    console.log(JSON.stringify(issue.records[0], undefined, 4))
    console.log('')
    console.log('Commands: f fix with claude, d delete, l later, n note, b back')
}


async function detail_loop(ask:Ask, handoff:TerminalHandoff, bucket:string,
        issue:IssueView):Promise<void>{
    // Handle actions on a single issue until the user goes back (or deletes it)
    print_detail(issue)
    while (true){
        const answer = (await ask('issue> ')).trim().toLowerCase()

        if (answer === 'b' || answer === 'q'){
            return

        } else if (answer === 'f'){
            // Fix it in an interactive claude session, then return to the list once it exits
            const path = write_prompt(issue)
            console.log(`Starting claude with the fix prompt (${path})...`)
            await run_claude(handoff, readFileSync(path, 'utf8'))
            return

        } else if (answer === 'd'){
            // Delete all the issue's reports from the bucket and locally
            const confirm = (await ask(
                `Delete ${issue.records.length} report(s) from the bucket? (y/N) `)).trim()
            if (confirm.toLowerCase() !== 'y'){
                continue
            }
            for (const record of issue.records){
                await delete_object(bucket, `errors/${record.fingerprint}/${record.id}.json`)
            }
            remove_issue_local(issue)
            console.log('Deleted')
            return

        } else if (answer === 'l'){
            // Defer — drops to the bottom of the list until new reports arrive
            const triage = load_triage()
            triage[issue.id] = {...triage[issue.id], status: 'deferred'}
            save_triage(triage)
            issue.status = 'deferred'
            console.log('Marked for later')

        } else if (answer === 'n'){
            // Attach a free-text note
            const note = (await ask('note> ')).trim()
            const triage = load_triage()
            triage[issue.id] = {status: triage[issue.id]?.status ?? 'new', note}
            save_triage(triage)
            issue.note = note
            console.log('Noted')

        } else {
            print_detail(issue)
        }
    }
}


export async function run_tui(bucket:string,
        refresh:(download:boolean) => Promise<IssueView[]>):Promise<void>{
    // Main loop: list issues, open one, act on it
    const {ask, close, handoff} = make_ask()
    let issues = await refresh(false)
    try {
        while (true){
            print_list(issues)
            const answer = (await ask('> ')).trim().toLowerCase()
            if (answer === 'q'){
                return
            } else if (answer === 'r'){
                issues = await refresh(true)
            } else {
                const index = Number(answer)
                if (Number.isInteger(index) && index >= 1 && index <= issues.length){
                    await detail_loop(ask, handoff, bucket, issues[index - 1]!)
                    // Reassemble from local state (an issue may have been deleted/deferred)
                    issues = await refresh(false)
                }
            }
        }
    } finally {
        close()
    }
}
