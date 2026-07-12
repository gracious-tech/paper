
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {list_error_objects, download_object} from './bucket.ts'
import {ensure_dirs, local_object_names, save_record, load_records, load_issues, load_triage,
    assemble_issues} from './store.ts'
import {classify_new_fingerprints} from './analyse.ts'
import {run_tui} from './tui.ts'

import type {IssueView} from './store.ts'


// Entry point (run via .bin/errors): download new error reports from the bucket, have claude
// cluster new fingerprints into issues, then triage them in the TUI


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


async function sync_records():Promise<void>{
    // Download records not yet mirrored locally (bucket-deleted ones are left in place —
    // deleting via the TUI removes both sides)
    const local = local_object_names()
    const remote = (await list_error_objects(bucket)).filter(name => name.endsWith('.json'))
    const missing = remote.filter(name => !local.has(name))
    console.log(`${remote.length} report(s) in bucket, downloading ${missing.length} new`)
    for (const name of missing){
        save_record(name, await download_object(bucket, name))
    }
}


async function refresh(download:boolean):Promise<IssueView[]>{
    // Rebuild the TUI's issue views, optionally pulling from the bucket + classifying first
    if (download){
        await sync_records()
        classify_new_fingerprints(load_records())
    }
    return assemble_issues(load_records(), load_issues(), load_triage())
}


ensure_dirs()
await sync_records()
classify_new_fingerprints(load_records())
await run_tui(bucket, refresh)
