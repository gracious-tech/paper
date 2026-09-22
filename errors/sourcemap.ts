
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import {TraceMap, originalPositionFor} from '@jridgewell/trace-mapping'


// Resolves minified 'file.js:line:col' references in a report's message back to original
// source, using the sourcemaps .bin/deploy_app archives locally per build (see
// vite.config.mts: sourcemap:'hidden') — bundle filenames are content-hashed, so a map found
// here is guaranteed to match the exact code that produced the report


export const SOURCEMAPS_DIR = join('errors', 'sourcemaps')

// e.g. 'https://.../assets/index-Dh7wGl6X.js:249:12345' or 'index-Dh7wGl6X.js:249:12345' —
// the character class excludes '/', so this captures just the bundle's basename even out of a
// full URL
const STACK_FRAME = /(?:^|[/\s(])([A-Za-z0-9_.-]+\.js):(\d+):(\d+)/g

const map_cache = new Map<string, TraceMap|null>()


function load_map(filename:string):TraceMap|null{
    // Parse (and cache) an archived .map file by its bundle's filename, if we have it —
    // absent for reports from a build whose map was never archived (predates this feature)
    // or already an original, unminified reference
    if (map_cache.has(filename)){
        return map_cache.get(filename)!
    }
    const path = join(SOURCEMAPS_DIR, `${filename}.map`)
    const map = existsSync(path) ? new TraceMap(readFileSync(path, 'utf8')) : null
    map_cache.set(filename, map)
    return map
}


export function symbolicate(message:string):string{
    // Append resolved source locations for every minified stack frame we have an archived map
    // for. Leaves the message itself untouched (and returns it as-is when nothing resolves) so
    // callers can't lose the original minified reference
    const resolved:string[] = []
    for (const [, filename, line, column] of message.matchAll(STACK_FRAME)){
        const map = load_map(filename!)
        if (!map){
            continue
        }
        // Stack traces are 1-based line/column; trace-mapping wants a 0-based column
        const pos = originalPositionFor(map, {line: Number(line), column: Number(column) - 1})
        if (pos.source){
            const label = pos.name ? ` (${pos.name})` : ''
            resolved.push(`${filename}:${line}:${column} -> ${pos.source}:${pos.line}:${pos.column}${label}`)
        }
    }
    if (!resolved.length){
        return message
    }
    return `${message}\n\nResolved source locations:\n${resolved.join('\n')}`
}
