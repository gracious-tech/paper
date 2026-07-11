
// Best-effort peak-memory sampling for the stress harnesses: polls `ps` for the resident set
// size of processes matching a pattern while a compile runs. ~100ms sampling can miss brief
// spikes, so treat peaks as a floor rather than an exact ceiling.

import {execSync} from 'node:child_process'


// Sum the current RSS (KiB) of all processes whose command line matches the pattern
export function sample_rss_kb(pattern:RegExp):number {
    let total_kb = 0
    try {
        const out = execSync('ps -eo rss=,args=', {encoding: 'utf-8'})
        for (const line of out.split('\n')){
            const match = /^\s*(\d+)\s+(.*)$/.exec(line)
            if (match && pattern.test(match[2]!)){
                total_kb += Number(match[1])
            }
        }
    } catch {
        // ps hiccup — report nothing for this sample
    }
    return total_kb
}


// Start polling matching processes, returning a handle whose stop() yields the peak MiB seen
export function start_rss_poll(pattern:RegExp, interval_ms = 100):{stop:()=>number} {
    let peak_kb = sample_rss_kb(pattern)
    const timer = setInterval(() => {
        peak_kb = Math.max(peak_kb, sample_rss_kb(pattern))
    }, interval_ms)
    return {
        stop(){
            clearInterval(timer)
            return Math.round(peak_kb / 1024)
        },
    }
}
