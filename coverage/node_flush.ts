
// Preloaded (--import) into the Node processes a coverage run spawns — the API server the
// journeys run, the servers tests/server/routes.test.ts boots — so their V8 coverage reaches
// coverage/merge.ts. See child_coverage_env() in scope.ts, the only place that adds it.
//
// Two things NODE_V8_COVERAGE alone doesn't do. It writes only on a normal exit, and these
// processes are ended by a signal, so a signal now exits normally. And it records offsets into
// the type-stripped source Node actually ran, which nothing on disk holds: MCR would read the .ts
// file and fail to parse its types. So each in-scope module's stripped source is saved beside
// the coverage, the way MCR's own register hook saves sources (a source-*.json keyed by url)

import {createHash} from 'node:crypto'
import {mkdirSync, writeFileSync} from 'node:fs'
import {registerHooks, stripTypeScriptTypes} from 'node:module'
import {fileURLToPath} from 'node:url'

import {in_scope, ROOT} from './scope.ts'


const dir = process.env['NODE_V8_COVERAGE']


// Save the source a module ran as, under the name MCR's addFromDir looks for. It carries an
// identity sourcemap back to the original TypeScript, because MCR merges a file across runs by
// its original path + content: without one this run's copy would be a separate file from the
// unit suites' (whose maps lead to the original), and every server file would count twice.
// Stripping keeps every offset, so one mapping per line suffices — MCR aligns within a line
// by diffing the text
function save_source(url:string, original:string):void{
    const lines = original.split('\n').length
    const map = {
        version: 3,
        sources: [fileURLToPath(url)],
        sourcesContent: [original],
        names: [],
        // Line 1 col 0 → line 1 col 0, then each next line's start → the next original line's
        mappings: 'AAAA' + ';AACA'.repeat(lines - 1),
    }
    const comment = '\n//# sourceMappingURL=data:application/json;base64,'
        + Buffer.from(JSON.stringify(map)).toString('base64')
    const id = createHash('sha1').update(url).digest('hex')
    writeFileSync(`${dir}/source-${id}.json`, JSON.stringify({url,
        source: stripTypeScriptTypes(original) + comment}))
}


if (dir){
    mkdirSync(dir, {recursive: true})

    // Capture each in-scope TypeScript module's runtime source as it loads
    registerHooks({
        load(url, context, next_load){
            const loaded = next_load(url, context)
            if (loaded.format?.endsWith('-typescript') && in_scope(url)){
                const source = typeof loaded.source === 'string' ? loaded.source
                    : Buffer.from(loaded.source as Uint8Array).toString('utf8')
                save_source(url, source)
            }
            return loaded
        },
    })

    // A signal exits normally, which is when NODE_V8_COVERAGE writes its file — but only in this
    // repo's own entry points, which have nothing to clean up. The env reaches every process in
    // between too (the Firebase CLI starts the journeys' API server), and one of those exiting
    // straight away on SIGINT skips its own shutdown: the CLI's orphaned the Java emulators
    const entry = process.argv[1] ?? ''
    if (entry.startsWith(ROOT) && !entry.includes('/node_modules/')){
        for (const signal of ['SIGINT', 'SIGTERM'] as const){
            process.once(signal, () => process.exit(0))
        }
    }
}
