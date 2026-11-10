
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import type {ErrorRecord} from '../server/src/error_schema.ts'


// The repos the triage tool fixes issues in: this one, and the bookcover repo that the cover
// editor widget paper.bible embeds is built from (the sibling checkout ../paper_cover, see the
// workspace AGENTS.md). The widget relays its errors through the app, tagged with the bookcover
// commit it was built from, so its issues are fixed, committed and pinned there instead


// A check to run: [dir relative to the checkout, command, args]
export type Step = [string, string, string[]]

export interface Repo {
    name:string
    root:string  // Its main checkout, absolute
    product:string  // What the fixer is told it's working on
    editable_dirs:string[]  // The only dirs a fixer may change, relative to the root
    typechecks:Step[]  // Run in the fixer's worktree: they read the code and run none of it
    verify:Step[]  // What its CI runs before deploying, run in the main checkout
    diagnostics:string  // Where a fixer adds detail to future reports
    build_of:(record:ErrorRecord) => string|null  // The commit of its own a report ran
}


// Every package of the bookcover repo with code the widget runs, in dependency order
const COVER_PACKAGES = ['typst/typst-utils', 'typst/typst-fonts', 'typst/pm-to-typst',
    'generator', 'generator-node', 'generator-web', '3d', 'widget']

export const BIBLE:Repo = {
    name: 'paper_bible',
    root: resolve(import.meta.dirname, '..'),
    product: 'the live app paper.bible (a Vue app and a Node API that make printable Bibles)',
    editable_dirs: ['app/src/', 'app/tests/', 'server/src/', 'tests/server/', 'typst/src/',
        'typst/tests/', 'typst-web/src/', 'typst-web/tests/', 'typst-node/src/',
        'typst-node/tests/'],
    // CI's Typecheck step (deploy.yml)
    typechecks: [
        ['app', 'npx', ['vue-tsc', '--noEmit', '-p', 'tsconfig.json']],
        ['.', 'npx', ['tsc', '-p', 'server/tsconfig.json']],
        ['.', 'npx', ['tsc', '-p', 'e2e/tsconfig.json']],
        ['.', 'npx', ['tsc', '-p', 'errors/tsconfig.json']],
        ['.', 'npx', ['tsc', '-p', 'coverage/tsconfig.json']],
    ],
    verify: [],  // Filled in below, as it includes the typechecks
    diagnostics: 'the `context` option of report_error() in app/src/services/errors.ts',
    build_of: record => record.build ?? null,
}
BIBLE.verify = [['.', '.bin/build_typst', []], ...BIBLE.typechecks, ['.', '.bin/audit_unit', []]]

export const COVER:Repo = {
    name: 'paper_cover',
    root: resolve(BIBLE.root, '..', 'paper_cover'),
    product: 'the cover editor widget (the bookcover repo), which paper.bible embeds in an iframe'
        + ' and relays errors from',
    editable_dirs: [...COVER_PACKAGES.flatMap(dir => [`${dir}/src/`, `${dir}/tests/`]),
        'widget/e2e/'],
    // Its CI has no typecheck of its own beyond building the libraries, which tsc does; the
    // widget's .vue files aren't typechecked anywhere
    typechecks: COVER_PACKAGES.filter(dir => dir !== 'widget')
        .map(dir => ['.', 'npx', ['tsc', '--noEmit', '-p', `${dir}/tsconfig.json`]]),
    // Its CI's unit tests (test.yml), then the widget's production bundle. The browser tests
    // need a downloaded Chromium and the network, so they're left to CI, which runs them before
    // any deploy
    verify: [['.', '.bin/test', []], ['.', '.bin/build_widget', []]],
    diagnostics: 'the `context` argument of report_error() in widget/src/error_report.ts',
    build_of: record => {
        const build = record.context?.['widget_build']
        return typeof build === 'string' ? build : null
    },
}


export function repo_of(issue:{cover_widget:boolean}):Repo{
    // The repo an issue's code lives in
    return issue.cover_widget ? COVER : BIBLE
}


export function dependency_dirs(repo:Repo):string[]{
    // A checkout's node_modules dirs (root, per workspace, and any other top-level dir with
    // one), relative to its root
    const read_workspaces = ():string[] => {
        try {
            const workspaces = (JSON.parse(readFileSync(join(repo.root, 'package.json'), 'utf8')) as
                {workspaces?:unknown}).workspaces
            return Array.isArray(workspaces) ? workspaces.filter(dir => typeof dir === 'string')
                : []
        } catch {
            return []
        }
    }
    const top_level = existsSync(repo.root) ? readdirSync(repo.root, {withFileTypes: true})
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name) : []
    const candidates = ['.', ...new Set([...read_workspaces(), ...top_level])]
    return candidates.map(dir => join(dir, 'node_modules'))
        .filter(dir => /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(dir) && !dir.includes('..')
            && existsSync(join(repo.root, dir)))
}
