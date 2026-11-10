
import {execFileSync, spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

import {BUILD} from '../server/src/error_schema.ts'


// Git for the triage tool, in whichever repo an issue belongs to (see repos.ts): placing reports
// relative to fix commits, checking the working tree, the throwaway worktrees the fixer edits,
// and applying and committing a fix that passed every check (never pushing). Every call disables
// the repository hooks and fsmonitor, so nothing a fixer wrote (a hook, a config, a .git
// pointer) can run through git, and a worktree is only ever addressed by the git dir captured
// when it was made, never by whatever its .git file says afterwards


// Settings applied to every git call
const HARDENING = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null']

// A throwaway checkout of HEAD for the fixer to edit
export interface Worktree {
    root:string  // The main checkout it belongs to
    dir:string
    git_dir:string  // Captured at creation, before anything else could touch the checkout
    base:string  // The commit it was made from
}

// One file a fixer changed
export interface ChangedFile {
    status:string  // A/M/D/R/C/T as git reports it
    path:string
    from:string|null  // The original path of a rename or copy
    mode:string  // The new file mode ('000000' when deleted)
    binary:boolean
}


function git(root:string, ...args:string[]):string{
    // Run a git command in a repo's main checkout, returning its trimmed stdout
    return execFileSync('git', [...HARDENING, ...args],
        {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: root}).trim()
}


function worktree_git(tree:Worktree, ...args:string[]):string{
    // Run a git command against a worktree, by its captured git dir
    return execFileSync('git', [...HARDENING, '--git-dir', tree.git_dir, '--work-tree', tree.dir,
        ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: tree.dir})
}


function lines(output:string):string[]{
    // Split command output into non-empty lines
    return output.split('\n').filter(line => line.trim())
}


export function head_commit(root:string):string{
    // Full hash of the commit a checkout has checked out
    return git(root, 'rev-parse', 'HEAD')
}


export function resolve_commit(root:string, ref:string):string|null{
    // Full hash for a ref/short hash, or null if it doesn't name a commit in that repo
    if (ref.startsWith('-')){
        return null
    }
    try {
        return git(root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`)
    } catch {
        return null
    }
}


export function tracked_changes(root:string):string[]{
    // A checkout's uncommitted changes to tracked files (staged or not), as porcelain status lines
    return lines(git(root, 'status', '--porcelain', '--untracked-files=no'))
}


// Ancestry answers are immutable, so cache them for the whole run (key: repo, commit, build)
const ancestry = new Map<string, boolean>()


export function build_includes(build:string|null|undefined, commit:string, root:string)
        :boolean{
    // Whether a report's build contains the given commit of the repo at root. No build means the report predates
    // build stamping, so necessarily also predates any fix recorded since; 'dev' reports only
    // ever come from the local emulators. A build git doesn't know (not fetched yet) counts as
    // including it, so an unrecognised build surfaces rather than being filed away unseen
    if (!build || build === 'dev' || build === 'unknown' || !BUILD.test(build)){
        return false
    }
    const hash = build.replace(/-dirty$/, '')
    const key = `${root} ${commit} ${hash}`
    let result = ancestry.get(key)
    if (result === undefined){
        // Exit 0 = ancestor, 1 = not; anything else means an unknown object
        const status = spawnSync('git', [...HARDENING, 'merge-base', '--is-ancestor',
            '--end-of-options', commit, hash], {cwd: root}).status
        result = status !== 1
        ancestry.set(key, result)
    }
    return result
}


export function create_worktree(root:string, label:string):Worktree{
    // Check a repo's HEAD out into a fresh temp dir, outside it, with no untracked files
    // (no .env, no records), capturing its git dir before anything else runs in it
    const parent = mkdtempSync(join(tmpdir(), `paper-bible-fix-${label.replace(/[^a-z0-9-]/gi, '_')}-`))
    const dir = join(parent, 'repo')
    const base = head_commit(root)
    git(root, 'worktree', 'add', '--detach', '--quiet', dir, base)
    const git_dir = resolve(dir, execFileSync('git', [...HARDENING, 'rev-parse', '--git-dir'],
        {encoding: 'utf8', cwd: dir}).trim())
    return {root, dir, git_dir, base}
}


export function remove_worktree(tree:Worktree):void{
    // Delete a worktree and git's record of it
    git(tree.root, 'worktree', 'remove', '--force', tree.dir)
    rmSync(resolve(tree.dir, '..'), {recursive: true, force: true})
}


export function stage_changes(tree:Worktree):{files:ChangedFile[], patch:string}{
    // Everything that differs from the commit the worktree was made from, as files and a patch.
    // Ignore rules are overridden (-f), since a fixer could write a .gitignore to hide a file
    // from this check, and diffs bypass textconv and external diff drivers
    worktree_git(tree, 'add', '--all', '--force', '--', '.')
    const raw = worktree_git(tree, 'diff', '--cached', '--raw', '-z', '--no-abbrev', '-M',
        tree.base).split('\0').filter(entry => entry !== '')
    const numstat = worktree_git(tree, 'diff', '--cached', '--numstat', '-z', '--no-renames',
        tree.base)
    const binary = new Set(numstat.split('\0').filter(entry => entry.startsWith('-\t-\t'))
        .map(entry => entry.slice(4)))

    // --raw -z gives ':<old mode> <new mode> <old sha> <new sha> <status>' then one path, or
    // two for a rename/copy, each its own NUL-separated entry
    const files:ChangedFile[] = []
    for (let index = 0; index < raw.length; index++){
        const [, new_mode = '', , , status = ''] = raw[index]!.slice(1).split(' ')
        const kind = status.charAt(0)
        const two_paths = kind === 'R' || kind === 'C'
        const from = two_paths ? raw[++index]! : null
        const path = raw[++index]!
        files.push({status: kind, path, from, mode: new_mode, binary: binary.has(path)})
    }
    const patch = worktree_git(tree, 'diff', '--cached', '--no-textconv', '--no-ext-diff',
        tree.base)
    return {files, patch}
}


export function apply_patch(root:string, patch:string, reverse = false):void{
    // Apply a checked patch to a main checkout's working tree (not the index), or take it back
    // out
    execFileSync('git', [...HARDENING, 'apply', '--whitespace=nowarn',
        ...reverse ? ['--reverse'] : [], '-'], {input: patch, encoding: 'utf8', cwd: root})
}


export function file_at(tree:Worktree, path:string):string|null{
    // A file's content in the commit a worktree was made from, or null if it isn't there
    try {
        return worktree_git(tree, 'show', '--end-of-options', `${tree.base}:${path}`)
    } catch {
        return null
    }
}


export function commit_paths(root:string, paths:string[], message:string):string{
    // Commit exactly these paths (added, changed or deleted) in a main checkout, with hooks off,
    // returning the new commit's hash. Anything else already staged is left out of it
    git(root, 'add', '--all', '--', ...paths)
    git(root, 'commit', '--no-verify', '--quiet', '--message', message, '--', ...paths)
    return head_commit(root)
}


export function history_since(root:string, build:string, paths:string[]):string{
    // What changed since a report's build, as one line per commit plus the files it touched,
    // limited to the given paths when there are any. Empty when the build isn't a commit here
    const hash = BUILD.test(build) ? build.replace(/-dirty$/, '') : ''
    if (!/^[0-9a-f]{7,40}$/.test(hash) || !resolve_commit(root, hash)){
        return ''
    }
    const safe = paths.filter(path => /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path))
    return git(root, 'log', '--no-merges', '--max-count=30', '--format=%h %s', '--stat=100,80',
        `${hash}..HEAD`, '--', ...safe).slice(0, 8000)
}
