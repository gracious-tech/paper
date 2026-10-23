
// What counts as the product's code for coverage, and where each run's data goes — shared by
// every collector (the unit suites' vitest provider, the journeys' browser collection, the Node
// processes the journeys and route tests spawn) and by the merge, so a file is in or out of the
// total for the same reason everywhere. See .bin/audit_coverage

import {fileURLToPath} from 'node:url'
import {stripTypeScriptTypes} from 'node:module'


// The repo root, with a trailing slash
export const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Every run's output lives under here (gitignored); raw/<run>/ is what the merge reads
export const REPORTS_DIR = `${ROOT}coverage/reports/`
export const RAW_DIR = `${REPORTS_DIR}raw/`

// Where Node processes spawned during a run write their V8 coverage (NODE_V8_COVERAGE)
export const NODE_V8_DIR = `${REPORTS_DIR}node_v8/`


// The env a spawned Node process needs for its coverage to be collected, when this is a coverage
// run (COVERAGE=1, set by .bin/audit_coverage), and nothing otherwise. Given to children only:
// on the test runner itself it would make every runner process dump its whole coverage too
export function child_coverage_env():Record<string, string>{
    if (process.env['COVERAGE'] !== '1'){
        return {}
    }
    return {
        NODE_V8_COVERAGE: NODE_V8_DIR,
        // (node_flush.ts strips types with node:module's still-experimental helper)
        NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --import ${ROOT}coverage/node_flush.ts`
            + ' --disable-warning=ExperimentalWarning',
    }
}


// The source trees that make up the product. Dev tooling (i18n, errors triage, generators) and
// the e2e harness have tests of their own or are tests, so they'd only dilute the figure
const SOURCE_DIRS = ['app/src/', 'server/src/', 'typst/src/', 'typst-web/src/', 'typst-node/src/']

// Within those: third-party code we vendor, generated tables, and type-only files
const EXCLUDED = [/\/vendor\//, /\/generated\//, /\.d\.ts$/, /\/types\.ts$/, /\.json$/]


// Whether a source path (absolute, repo-relative, or a file:// / dev-server URL) is product code
export function in_scope(source:string):boolean{
    const path = repo_relative(source)
    return SOURCE_DIRS.some(dir => path.startsWith(dir))
        && !EXCLUDED.some(pattern => pattern.test(path))
        && /\.(ts|vue)$/.test(path)
}


// A source path made relative to the repo root, whichever form it arrived in, so the same file
// lines up across runs: file:///…/app/src/x.ts from Node, /src/x.ts or /@fs/…/typst/src/x.ts
// from the Vite dev server the journeys use, plain paths from sourcemaps
export function repo_relative(source:string):string{
    let path = source.replace(/^file:\/\//, '').replace(/[?#].*$/, '')
    // Dev-server URLs: the origin goes (as a URL, or the host-port form MCR turns one into), and
    // /src/ is the app's own (Vite serves app/ as root)
    path = path.replace(/^https?:\/\/[^/]+/, '').replace(/^[\w.]+-\d+(?=\/)/, '')
        .replace(/^\/@fs/, '')
    if (path.startsWith('/src/')){
        return `app${path}`
    }
    if (path.startsWith(ROOT)){
        return path.slice(ROOT.length)
    }
    // Sourcemap sources resolved against a served URL rather than the disk
    const at = SOURCE_DIRS.map(dir => path.indexOf(`/${dir}`)).find(index => index >= 0)
    return at === undefined ? path.replace(/^\/+/, '') : path.slice(at + 1)
}


// MCR options every run shares: the scope as filters, and repo-relative paths
export function shared_options(){
    return {
        logging: 'error' as const,
        baseDir: ROOT,
        // Entries are scripts as loaded; only the typst packages are wanted from node_modules
        // (the app imports them by package name, so Vite serves them from there)
        // A component's template and styles are separate requests too, compiled from Pug and
        // SugarSS with no map back to them, so they'd only measure generated code (its <script>
        // is the component's own entry, which maps to the .vue)
        entryFilter: (entry:{url:string}) => (!entry.url.includes('/node_modules/')
            || entry.url.includes('/paper-bible-typst'))
            && !/[?&]vue&type=(template|style)|[?&]type=style/.test(entry.url),
        // Sources are what the entries' sourcemaps unpack to
        sourceFilter: (source:string) => in_scope(source),
        sourcePath: (source:string, info:{distFile?:string}) => resolve_source(source,
            info.distFile),
        // And the final check, since an entry with no sourcemap is its own source and never
        // reaches sourceFilter or sourcePath. One still named as served is compiled code with
        // nothing to map back to — a .vue with no <script>, which is all template
        outputFilter: (file:{sourcePath:string}) => in_scope(file.sourcePath)
            && repo_relative(file.sourcePath) === file.sourcePath,
    }
}


// A sourcemap source's repo-relative path. Maps name sources relative to something other than
// the repo — Vitest's and Vite's to their project root (typst/'s "src/x.ts"), tsc's to the
// built file (typst/dist/x.js's "../src/x.ts") — and MCR resolves them against the working
// directory, losing which package they belong to. Both are recoverable from the file that was
// loaded: a Vitest/Vite transform is 1:1, so a source named like the loaded file *is* it; a
// typst package's dist/ file maps into the same package's src/
function resolve_source(source:string, dist_file:string|undefined):string{
    const path = repo_relative(source)
    if (!dist_file){
        return path
    }
    const dist = repo_relative(dist_file)
    if (dist.split('/').pop() === path.split('/').pop()){
        return dist
    }
    const built = /^(typst[\w-]*)\/dist\//.exec(dist)
    if (built && path.startsWith('src/')){
        return `${built[1]}/${path}`
    }
    return path
}


// For the merge only: files no run loaded at all, counted as uncovered rather than left out
// (see `all` in MCR's docs). Only .ts can be added that way: Node strips its types in place, so
// offsets stay valid without a sourcemap. A .vue file has to be compiled first, so one that no
// run loads isn't counted
export const ALL_FILES = {
    dir: SOURCE_DIRS.map(dir => `${ROOT}${dir}`),
    filter: (path:string) => in_scope(path) && path.endsWith('.ts') ? 'js' as const : false,
    transformer: async (entry:{source:string}) => {
        entry.source = stripTypeScriptTypes(entry.source)
    },
}
