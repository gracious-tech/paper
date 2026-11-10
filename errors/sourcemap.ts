
import {existsSync, readFileSync} from 'node:fs'
import {join, posix} from 'node:path'

import {TraceMap, originalPositionFor} from '@jridgewell/trace-mapping'


// Resolves minified 'file.js:line:col' references in a report's message back to original
// source, using the sourcemaps .bin/deploy_app archives per build in the site bucket's private
// sourcemaps/ prefix, which .bin/audit_errors syncs down to here first (see vite.config.mts:
// sourcemap:'hidden') — bundle filenames are content-hashed, so a map found
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


// Where the bundles (and so their maps) were built, which map sources are relative to
const BUNDLE_DIR = 'app/dist/assets'

// A minified stack frame resolved to the original source
export interface ResolvedFrame {
    frame:string  // As it appeared in the report, e.g. 'index-Dh7wGl6X.js:249:12345'
    source:string  // Repo-relative path, e.g. 'app/src/services/designs.ts'
    line:number
    column:number
    name:string|null  // The original identifier at that position, when the map names one
}


export function resolve_frames(message:string):ResolvedFrame[]{
    // Resolve every minified stack frame in a message that we have an archived map for, in the
    // order they appear (innermost first)
    const resolved:ResolvedFrame[] = []
    for (const [, filename, line, column] of message.matchAll(STACK_FRAME)){
        const map = load_map(filename!)
        if (!map){
            continue
        }
        // Stack traces are 1-based line/column; trace-mapping wants a 0-based column
        const pos = originalPositionFor(map, {line: Number(line), column: Number(column) - 1})
        if (pos.source){
            resolved.push({
                frame: `${filename}:${line}:${column}`,
                source: posix.normalize(posix.join(BUNDLE_DIR, pos.source.replace(/\?.*$/, ''))),
                line: pos.line,
                column: pos.column,
                name: pos.name,
            })
        }
    }
    return resolved
}


export function app_frame(frames:ResolvedFrame[]):ResolvedFrame|null{
    // The innermost frame in this repository's own code (not a dependency), if any
    return frames.find(frame => !frame.source.includes('node_modules/')) ?? null
}
