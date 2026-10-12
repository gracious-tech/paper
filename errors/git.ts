
import {execFileSync, spawnSync} from 'node:child_process'


// Read-only git queries: placing reports relative to fix commits, and checking the working tree
// around an automatic fix. Nothing here writes to the repository — committing and discarding
// always stay with the developer


function git(...args:string[]):string{
    // Run a git command, returning its trimmed stdout
    return execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).trim()
}


function lines(output:string):string[]{
    // Split command output into non-empty lines
    return output.split('\n').filter(line => line.trim())
}


export function head_commit():string{
    // Full hash of the commit currently checked out
    return git('rev-parse', 'HEAD')
}


export function resolve_commit(ref:string):string|null{
    // Full hash for a ref/short hash, or null if it doesn't name a commit here
    try {
        return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
    } catch {
        return null
    }
}


export function tracked_changes():string[]{
    // Uncommitted changes to tracked files (staged or not), as porcelain status lines
    return lines(git('status', '--porcelain', '--untracked-files=no'))
}


export function untracked_files():string[]{
    // Untracked, non-ignored files (paths relative to the repo root)
    return lines(git('ls-files', '--others', '--exclude-standard'))
}


export function diff_stat():string{
    // Summary of uncommitted changes to tracked files
    return git('diff', 'HEAD', '--stat')
}


// Ancestry answers are immutable, so cache them for the whole run (key: commit + build hash)
const ancestry = new Map<string, boolean>()


export function build_includes(build:string|null|undefined, commit:string):boolean{
    // Whether a report's build contains the given commit. No build means the report predates
    // build stamping, so necessarily also predates any fix recorded since; 'dev' reports only
    // ever come from the local emulators. A build git doesn't know (not fetched yet) counts as
    // including it, so an unrecognised build surfaces rather than being filed away unseen
    if (!build || build === 'dev' || build === 'unknown'){
        return false
    }
    const hash = build.replace(/-dirty$/, '')
    const key = `${commit} ${hash}`
    let result = ancestry.get(key)
    if (result === undefined){
        // Exit 0 = ancestor, 1 = not; anything else means an unknown object
        const status = spawnSync('git', ['merge-base', '--is-ancestor', commit, hash]).status
        result = status !== 1
        ancestry.set(key, result)
    }
    return result
}

