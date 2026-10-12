
import {createInterface} from 'node:readline'
import {spawn} from 'node:child_process'


// Line-based terminal I/O for the TUI, plus handing the terminal to child processes


// Question prompt that buffers lines arriving between questions — plain readline.question()
// drops them, which breaks scripted/piped input (e.g. `printf '1\nb\nq\n' | .bin/audit_errors`)
export type Ask = (prompt:string) => Promise<string>

// Hands the terminal to a child process and back again (see run_attached())
export interface TerminalHandoff {
    suspend:() => void
    resume:() => void
}

// Everything the TUI needs to talk to the developer
export interface Terminal {
    ask:Ask
    close:() => void
    handoff:TerminalHandoff
}


// Widest an output line gets before wrapping (less if the terminal itself is narrower)
const MAX_WIDTH = 100


export function print_wrapped(text:string, indent:number):void{
    // Print text word-wrapped to the output width, with every line after the first indented by
    // `indent` so a wrapped entry reads as one item. A word longer than a line is left whole
    const width = Math.min(MAX_WIDTH, process.stdout.columns || MAX_WIDTH)
    const pad = ' '.repeat(indent)
    const lines:string[] = []
    for (const paragraph of text.split('\n')){
        // The first line keeps its own leading space (part of the caller's layout)
        let line = lines.length ? pad
            : paragraph.slice(0, paragraph.length - paragraph.trimStart().length)
        // Each word carries its trailing spaces, so column padding within a line survives
        for (const word of paragraph.trimStart().match(/\S+ */g) ?? []){
            if (line.trim() && line.length + word.trimEnd().length > width){
                lines.push(line.trimEnd())
                line = pad
            }
            line += word
        }
        lines.push(line.trimEnd())
    }
    console.log(lines.join('\n'))
}


export function make_terminal():Terminal{
    // Set up the buffered prompt over stdin/stdout
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
    // Stop reading stdin (and leave raw mode, so Ctrl+C is a real signal again) while a child
    // owns the terminal, then restore readline's raw mode afterwards since the child resets the
    // TTY on its way out
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


export async function with_terminal_handed_off<T>(handoff:TerminalHandoff,
        run:() => Promise<T>):Promise<T>{
    // Run something that owns the terminal. Ctrl+C reaches the whole process group, so it's
    // ignored here and left for the child to handle (stopping it, not the TUI)
    handoff.suspend()
    const ignore_sigint = () => {}
    process.on('SIGINT', ignore_sigint)
    try {
        return await run()
    } finally {
        process.off('SIGINT', ignore_sigint)
        handoff.resume()
    }
}


export async function run_attached(handoff:TerminalHandoff, command:string, args:string[])
        :Promise<void>{
    // Run an interactive command (claude, git's pager) in the terminal until it exits
    await with_terminal_handed_off(handoff, () => new Promise<void>(resolve => {
        const child = spawn(command, args, {stdio: 'inherit'})
        child.on('error', error => {
            console.error(`Could not start ${command}: ${error.message}`)
            resolve()
        })
        child.on('exit', () => {
            resolve()
        })
    }))
}

