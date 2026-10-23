
// Merge every run's raw coverage into the one report .bin/audit_coverage prints and writes:
// the unit groups' and the journeys' raw exports (coverage/reports/raw/*), plus the V8 output of
// the Node processes those runs spawned (coverage/reports/node_v8/). The data stays V8 up to
// this point, so the same file reached by different runs is merged by byte range, not by adding
// up per-tool statement counts that were never aligned with each other.
//
// Usage: node coverage/merge.ts [run ...]   (the runs that must have contributed, checked first)

import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'

import {MCR} from 'monocart-coverage-reports'

import {ALL_FILES, NODE_V8_DIR, RAW_DIR, REPORTS_DIR, shared_options} from './scope.ts'


// Where the merged report goes
const MERGED_DIR = `${REPORTS_DIR}merged`


// Whether a raw export holds any coverage at all (an empty one means its run collected nothing)
function raw_has_data(dir:string):boolean{
    return readdirSync(dir).filter(name => name.startsWith('coverage-') && name.endsWith('.json'))
        .some(name => {
            const raw = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as {data:unknown}
            return Array.isArray(raw.data) ? raw.data.length > 0
                : Object.keys(raw.data as object).length > 0
        })
}


// Fold the spawned Node processes' V8 files into a raw export of their own, so the merge below
// reads one format. They're written as each process flushes (see coverage/node_flush.ts)
async function export_node_v8():Promise<void>{
    if (!existsSync(NODE_V8_DIR) || !readdirSync(NODE_V8_DIR).length){
        return
    }
    const report = MCR({
        ...shared_options(),
        outputDir: `${REPORTS_DIR}work/node`,
        cleanCache: true,
        reports: [['raw', {outputDir: `${RAW_DIR}node`}]],
    })
    await report.addFromDir(NODE_V8_DIR)
    await report.generate()
}


await export_node_v8()

// Every run asked for must have contributed, or the total would quietly shrink to what's left
const runs = existsSync(RAW_DIR) ? readdirSync(RAW_DIR) : []
const missing = process.argv.slice(2).filter(run => !runs.includes(run)
    || !raw_has_data(`${RAW_DIR}${run}`))
if (missing.length){
    throw new Error(`No coverage from: ${missing.join(', ')}`)
}
if (!runs.length){
    throw new Error('No coverage to merge — run .bin/audit_coverage')
}

const report = MCR({
    ...shared_options(),
    name: 'Paper Bible coverage',
    inputDir: runs.map(run => `${RAW_DIR}${run}`),
    outputDir: MERGED_DIR,
    cleanCache: true,
    all: ALL_FILES,
    reports: [
        // The browsable report, and the summaries for terminals, CI and scripts
        'v8',
        'console-summary',
        'markdown-summary',
        'json-summary',
    ],
})
const results = await report.generate()
if (!results?.files.length){
    throw new Error('The merge produced no coverage')
}

// Per-file line coverage, least covered first, for reading the gaps without opening the report
const rows = results.files
    .map(file => ({path: file.sourcePath, pct: file.summary.lines.pct as number,
        uncovered: file.summary.lines.uncovered as number}))
    .sort((a, b) => b.uncovered - a.uncovered)
writeFileSync(`${MERGED_DIR}/files.txt`, rows.map(row =>
    `${String(row.pct).padStart(6)}%  ${String(row.uncovered).padStart(5)} uncovered  ${row.path}`)
    .join('\n') + '\n')

console.log(`Runs merged: ${runs.join(', ')}`)
console.log(`Report: ${MERGED_DIR}/index.html (per file: ${MERGED_DIR}/files.txt)`)
