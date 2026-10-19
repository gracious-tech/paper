
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {list_error_objects, download_object, delete_object} from './bucket.ts'
import {ensure_dirs, save_record, has_valid_record, load_records, load_issues, load_triage,
    assemble_issues, load_synced, save_synced} from './store.ts'
import {classify_new_fingerprints, rank_issues} from './analyse.ts'
import {build_includes} from './git.ts'
import {run_tui} from './tui.ts'

import type {Snapshot} from './tui.ts'


// Entry point (run via .bin/audit_errors): move new error reports from the bucket to local
// storage, have claude cluster new fingerprints into issues and rank the open ones, then triage
// and fix them in the TUI


// Fall back to .firebaserc's default project so it doesn't need to be typed every time
// (resolved relative to this file, not cwd, so it works regardless of where node is invoked from)
const firebaserc_path = fileURLToPath(new URL('../.firebaserc', import.meta.url))
function default_project():string|undefined{
    try {
        const rc = JSON.parse(readFileSync(firebaserc_path, 'utf8')) as {projects?:{default?:string}}
        return rc.projects?.default
    } catch {
        return undefined
    }
}


const project = process.argv[2] ?? default_project()
if (!project){
    console.error('Usage: node errors/cli.ts <gcp-project-id> (or set a default in .firebaserc)')
    process.exit(1)
}
const bucket = process.env['STORAGE_BUCKET'] ?? `${project}.firebasestorage.app`

// How long after a sync starting the tool skips the bucket
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000


async function sync_records():Promise<void>{
    // Move reports from the bucket into the local store. The bucket is only an inbox: each
    // report is deleted there once its local copy is written and parses, never before, so a
    // failed download just leaves it for next time
    const remote = (await list_error_objects(bucket)).filter(name => name.endsWith('.json'))
    console.log(`${remote.length} new report(s) in the bucket`)
    let kept = 0
    for (const name of remote){
        if (!has_valid_record(name)){
            save_record(name, await download_object(bucket, name))
        }
        if (has_valid_record(name)){
            await delete_object(bucket, name)
        } else {
            kept += 1
        }
    }
    if (kept){
        console.warn(`${kept} report(s) didn't parse, so were left in the bucket`)
    }
    save_synced()
}


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
        await sync_records()
        classify_new_fingerprints(load_records())
    }
    return snapshot()
}


ensure_dirs()
if (sync_due()){
    await sync_records()
}
// Also retries a classification that failed last time (no claude call when nothing is pending)
classify_new_fingerprints(load_records())
await run_tui(refresh)

