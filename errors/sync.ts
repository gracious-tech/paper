import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {list_error_objects, download_object, delete_object} from './bucket.ts'
import {save_record, has_valid_record, save_synced} from './store.ts'


// Moving reports out of the bucket, shared by the TUI (cli.ts) and the headless run (headless.ts)


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


export function resolve_bucket(project_arg:string|undefined):string{
    // The Storage bucket the reports land in, for the given (or default) project
    const project = project_arg ?? default_project()
    if (!project){
        console.error('Usage: node errors/cli.ts <gcp-project-id> (or set a default in .firebaserc)')
        process.exit(1)
    }
    return process.env['STORAGE_BUCKET'] ?? `${project}.firebasestorage.app`
}


export async function sync_records(bucket:string):Promise<void>{
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
