import {ensure_dirs, load_records, load_issues, load_triage, assemble_issues,
    load_synced} from './store.ts'
import {classify_new_fingerprints, rank_issues} from './analyse.ts'
import {resolve_bucket, sync_records} from './sync.ts'
import {build_includes} from './git.ts'
import {run_tui} from './tui.ts'

import type {Snapshot} from './tui.ts'


// Entry point (run via .bin/audit_errors): move new error reports from the bucket to local
// storage, have claude cluster new fingerprints into issues and rank the open ones, then triage
// and fix them in the TUI


const bucket = resolve_bucket(process.argv[2])

// How long after a sync starting the tool skips the bucket
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000


function sync_due():boolean{
    // Startup only syncs once a day, so reopening the tool goes straight to the list (r syncs
    // on demand)
    const synced = load_synced()
    if (synced && Date.now() - new Date(synced).getTime() < SYNC_INTERVAL_MS){
        const hours = Math.floor((Date.now() - new Date(synced).getTime()) / (60 * 60 * 1000))
        console.log(`Last synced from the bucket ${hours}h ago (r to sync now)`)
        return false
    }
    return true
}


function snapshot():Snapshot{
    // Assemble the issue rows from local state, plus claude's ranking of the open ones
    const issues = assemble_issues(load_records(), load_issues(), load_triage(), build_includes)
    return {issues, priorities: rank_issues(issues)}
}


async function refresh(download:boolean):Promise<Snapshot>{
    // Rebuild the TUI's view, optionally pulling from the bucket + classifying first
    if (download){
        await sync_records(bucket)
        classify_new_fingerprints(load_records())
    }
    return snapshot()
}


ensure_dirs()
if (sync_due()){
    await sync_records(bucket)
}
// Also retries a classification that failed last time (no claude call when nothing is pending)
classify_new_fingerprints(load_records())
await run_tui(refresh)
