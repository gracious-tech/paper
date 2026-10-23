import {ensure_dirs, load_records, load_issues, load_triage, assemble_issues, list_prompt,
    write_prompt} from './store.ts'
import {classify_new_fingerprints, rank_issues} from './analyse.ts'
import {resolve_bucket, sync_records} from './sync.ts'
import {build_includes} from './git.ts'


// Headless entry point (`.bin/audit_errors --headless`), for an AI session doing the triage
// instead of the TUI: always sync from the bucket, classify and rank, then write the same issue
// list the TUI's claude session gets and print its path. The session then works through it with
// errors/triage.ts (show/set/note), as that prompt describes


ensure_dirs()
await sync_records(resolve_bucket(process.argv[2]))
classify_new_fingerprints(load_records())
const issues = assemble_issues(load_records(), load_issues(), load_triage(), build_includes)
console.log(write_prompt('_list', list_prompt(issues, rank_issues(issues))))
