
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {isAbsolute, relative} from 'node:path'

import {head_commit, tracked_changes, untracked_files, diff_stat} from './git.ts'
import {issue_prompt, write_prompt, update_triage} from './store.ts'
import {run_attached, with_terminal_handed_off} from './terminal.ts'

import type {IssueView} from './store.ts'
import type {Terminal} from './terminal.ts'


// The automatic fixer: claude works on one issue in the background on a clean tree, then the
// developer reviews the diff, discusses it in the same claude session, or rejects it. Accepting
// waits for the developer's own commit and pins the issue to it — this tool never touches git


// How the fixer must sum up its work
type Verdict = 'fixed'|'diagnostics'|'not_a_bug'|'unclear'
interface FixAnswer {
    verdict:Verdict
    summary:string
    verification:string
}

// A finished (or stopped) fixer run
interface FixResult extends FixAnswer {
    session_id:string|null
    cost_usd:number|null
    denials:number
}

const FIX_SCHEMA = {
    type: 'object',
    properties: {
        verdict: {type: 'string', enum: ['fixed', 'diagnostics', 'not_a_bug', 'unclear']},
        summary: {type: 'string'},
        verification: {type: 'string'},
    },
    required: ['verdict', 'summary', 'verification'],
}

// Edits are auto-accepted; beyond reading, only typechecks, tests and read-only git may run.
// Anything else is denied (headless runs can't ask), which the review reports
const ALLOWED_TOOLS = [
    'Read', 'Edit', 'Write', 'Glob', 'Grep',
    'Bash(npx tsc:*)', 'Bash(npx vue-tsc:*)', 'Bash(npx vitest:*)', 'Bash(.bin/audit_unit:*)',
    'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git blame:*)',
    'Bash(git status:*)',
]

// One stream-json event from `claude -p --output-format stream-json` (only the fields used)
interface StreamEvent {
    type:string
    session_id?:string
    message?:{content?:{type:string, name?:string, input?:Record<string, unknown>,
        text?:string}[]}
    structured_output?:FixAnswer
    result?:string
    total_cost_usd?:number
    permission_denials?:unknown[]
}


function fix_prompt(issue:IssueView):string{
    // The fixer's brief: the issue and its reports, then how to work and how to finish
    return [
        'Investigate and fix this error, reported by users of the live app (paper.bible). You',
        'are running unattended: nobody can answer questions until you finish, and the',
        'developer will review your diff before committing it.',
        '',
        issue_prompt(issue),
        '',
        '## How to work',
        '- Find the root cause before editing. A report\'s `build` is the commit it ran, so',
        '  `git log`/`git show` can tell you what changed since.',
        '- Make the smallest change that fixes the cause, written like the surrounding code',
        '  (the CLAUDE.md conventions apply).',
        '- Never hide the error instead of fixing it. No try/catch, optional chaining,',
        '  `.catch(() => ...)` or lowered report_error() severity whose effect is that this',
        '  report stops arriving while the failure still happens. Handling an error is right',
        '  only where there is a genuine recovery for the user.',
        '- If you cannot establish the cause with confidence, do not guess at a fix. Add',
        '  diagnostics instead: put the facts you are missing into the report (the `context`',
        '  option of report_error() in app/src/services/errors.ts, or a more specific message),',
        '  so the next report answers the question.',
        '- If this is not a bug in this code (browser extension, the user\'s network, an',
        '  unsupported device), change nothing and say so.',
        '- Verify: typecheck what you touched (e.g. `npx tsc -p server/tsconfig.json`; the app',
        '  uses vue-tsc) and run the relevant suite with `.bin/audit_unit <group> [filter]`,',
        '  adding or extending a test when the fix is testable there.',
        '- Do not commit, stage, stash or otherwise change git state, and do not start dev',
        '  servers or browsers.',
        '',
        '## Finishing',
        'verdict: "fixed" (a change addressing the root cause), "diagnostics" (added reporting',
        'detail because the cause could not be pinned down), "not_a_bug" (no edits; nothing here',
        'to change) or "unclear" (no progress). summary: 1-3 sentences on the cause and what you',
        'changed. verification: what you ran and the result.',
    ].join('\n')
}


function describe_tool(name:string, input:Record<string, unknown>):string{
    // One progress line for a tool call, e.g. 'Edit app/src/services/designs.ts'
    const target = input['file_path'] ?? input['command'] ?? input['pattern'] ?? input['path']
    if (typeof target !== 'string'){
        return name
    }
    const shown = isAbsolute(target) ? relative(process.cwd(), target) : target
    return `${name} ${shown.split('\n')[0]!.slice(0, 100)}`
}


async function run_fixer(term:Terminal, prompt:string):Promise<FixResult>{
    // Run claude headless on the brief, echoing its progress, until it finishes or is stopped
    const started = Date.now()
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'acceptEdits', '--json-schema', JSON.stringify(FIX_SCHEMA),
        '--allowedTools', ...ALLOWED_TOOLS]
    let session_id:string|null = null
    let final:StreamEvent|null = null

    await with_terminal_handed_off(term.handoff, () => new Promise<void>(resolve => {
        const child = spawn('claude', args, {stdio: ['pipe', 'pipe', 'inherit']})
        child.on('error', error => {
            console.error(`Could not start claude: ${error.message}`)
            resolve()
        })
        child.on('exit', () => {
            resolve()
        })
        child.stdin.end(prompt)

        // One JSON event per line
        createInterface({input: child.stdout}).on('line', line => {
            let event:StreamEvent
            try {
                event = JSON.parse(line) as StreamEvent
            } catch {
                return
            }
            session_id = event.session_id ?? session_id
            if (event.type === 'result'){
                final = event
            } else if (event.type === 'assistant'){
                for (const block of event.message?.content ?? []){
                    if (block.type === 'tool_use' && block.name !== 'StructuredOutput'){
                        console.log(`  · ${describe_tool(block.name ?? '?', block.input ?? {})}`)
                    } else if (block.type === 'text' && block.text?.trim()){
                        console.log(`  ${block.text.trim().split('\n')[0]!.slice(0, 120)}`)
                    }
                }
            }
        })
    }))

    // A run stopped early (Ctrl+C, crash) still gets reviewed — it may have left edits
    const minutes = ((Date.now() - started) / 60_000).toFixed(1)
    console.log(`Finished in ${minutes} min`)
    const done = final as StreamEvent|null
    return {
        ...(done?.structured_output ?? {verdict: 'unclear', verification: '',
            summary: done?.result || 'claude stopped before giving a verdict'}),
        session_id,
        cost_usd: done?.total_cost_usd ?? null,
        denials: done?.permission_denials?.length ?? 0,
    }
}


function print_review(result:FixResult, new_files:string[]):void{
    // Show the fixer's verdict and what it changed
    console.log('')
    console.log(`Verdict: ${result.verdict.toUpperCase()}`)
    console.log(result.summary)
    if (result.verification){
        console.log(`Verification: ${result.verification}`)
    }
    const cost = result.cost_usd === null ? '' : `$${result.cost_usd.toFixed(2)}`
    const denied = result.denials ? `, ${result.denials} tool call(s) denied` : ''
    if (cost || denied){
        console.log(`(${cost}${denied})`)
    }
    console.log('')
    const stat = diff_stat()
    console.log(stat || 'No changes to tracked files')
    if (new_files.length){
        console.log(`New files: ${new_files.join(', ')}`)
    }
    console.log('')
    console.log('Commands: v view diff, c discuss with claude, a accept (after you commit),'
        + ' r reject, i ignore issue, b back (leave changes)')
}


async function accept(term:Terminal, issue:IssueView, result:FixResult, start_head:string)
        :Promise<boolean>{
    // Wait for the developer to commit, then pin the issue to that commit. Returns whether
    // the issue was recorded (false = back to the review)
    console.log('Commit the change yourself, then press enter here (b to go back).')
    while (true){
        const answer = (await term.ask('committed? ')).trim().toLowerCase()
        if (answer === 'b' || answer === 'q'){
            return false
        }
        const head = head_commit()
        if (head === start_head){
            console.log('No new commit yet')
            continue
        }
        if (tracked_changes().length){
            const go = (await term.ask(
                'Uncommitted changes remain. Record HEAD as the fix anyway? (y/N) ')).trim()
            if (go.toLowerCase() !== 'y'){
                continue
            }
        }

        // The verdict suggests fixed vs diagnostics, but the developer decides
        const suggested = result.verdict === 'diagnostics' ? 'd' : 'f'
        const kind = (await term.ask(
            `Record as (f)ixed or (d)iagnostics added? [${suggested}] `)).trim().toLowerCase()
        const status = (kind || suggested) === 'd' ? 'diagnosing' : 'fixed'
        update_triage(issue.id, {status, commit: head, resolved: new Date().toISOString(),
            resolution: result.summary})
        console.log(`Marked ${status} at ${head.slice(0, 10)}. Reports from builds that include`
            + ' it will reopen the issue; older ones are filed quietly.')
        return true
    }
}


export async function auto_fix(term:Terminal, issue:IssueView):Promise<void>{
    // Fix one issue in the background, then review the result
    if (tracked_changes().length){
        console.log('Commit or set aside your uncommitted changes first, so the review shows'
            + ' only the fix.')
        return
    }
    const start_head = head_commit()
    const untracked_before = new Set(untracked_files())
    const prompt = fix_prompt(issue)
    write_prompt(issue, prompt)

    console.log(`\nFixing "${issue.summary}" with claude in the background (Ctrl+C stops it)`)
    const result = await run_fixer(term, prompt)
    const new_files = ():string[] => untracked_files().filter(file => !untracked_before.has(file))

    print_review(result, new_files())
    while (true){
        const answer = (await term.ask('review> ')).trim().toLowerCase()

        if (answer === 'b' || answer === 'q'){
            return

        } else if (answer === 'v'){
            // Tracked changes through git's pager, then each new file as a whole-file diff
            await run_attached(term.handoff, 'git', ['diff', 'HEAD'])
            for (const file of new_files()){
                await run_attached(term.handoff, 'git', ['diff', '--no-index', '--', '/dev/null',
                    file])
            }

        } else if (answer === 'c'){
            // Push back in the same session, with all of the fixer's context
            if (!result.session_id){
                console.log('No claude session to resume')
                continue
            }
            await run_attached(term.handoff, 'claude', ['--resume', result.session_id])
            print_review(result, new_files())

        } else if (answer === 'a'){
            if (!tracked_changes().length && !new_files().length
                    && head_commit() === start_head){
                console.log(result.verdict === 'not_a_bug'
                    ? 'Nothing changed. Use i to ignore the issue instead.'
                    : 'Nothing to accept yet')
                continue
            }
            if (await accept(term, issue, result, start_head)){
                return
            }

        } else if (answer === 'r'){
            // Discarding is a git operation, so it's left to the developer. The tree was clean
            // of tracked changes when the fixer started, so these undo exactly its work
            console.log('To discard the fixer\'s changes:')
            console.log('  git restore --staged --worktree -- .')
            const added = new_files()
            if (added.length){
                console.log(`  rm -- ${added.join(' ')}`)
            }
            return

        } else if (answer === 'i'){
            update_triage(issue.id, {status: 'ignored'})
            console.log('Ignored')
            if (tracked_changes().length || new_files().length){
                console.log('(the fixer\'s changes are still in the working tree)')
            }
            return

        } else {
            print_review(result, new_files())
        }
    }
}

