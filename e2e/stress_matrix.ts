
// Server-side runner for the layout-option stress matrix (see matrix.ts): compiles each config
// through the same pipeline as the Cloud Run fallback (BibleContent resolve → Typst CLI) and
// records wall time plus peak typst/node memory. Writes e2e/results/matrix_server.json
// (+ each config's PDF).
//
// Run with `node e2e/stress_matrix.ts` (dev content server on :8430, typst CLI, assets/fonts/ needed).
// STRESS_CONFIGS="psa_col1,jhn_col2" runs a subset (results still merge into the same file).

import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

import {PDFDocument} from 'pdf-lib'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'

import {build_blueprint} from './tiers.ts'
import {get_configs} from './matrix.ts'
import {start_rss_poll} from './rss.ts'


// One row of the results file
interface ConfigResult {
    config:string
    note:string
    books:number
    ok:boolean
    total_ms:number
    pages?:number
    pdf_mb?:number
    typst_peak_mb:number
    node_peak_mb:number
    error?:string
}


const e2e_dir = dirname(fileURLToPath(import.meta.url))
const root = dirname(e2e_dir)
const results_dir = join(e2e_dir, 'results')
const results_file = join(results_dir, 'matrix_server.json')

// Same setup .bin/serve_server gives the local API server (which mirrors Cloud Run)
const compile_options = {
    typst_path: join(root, '.bin', 'typst'),
    fonts_dir: join(root, 'fonts'),
    endpoint: 'http://localhost:8430/',
}


// Merge a finished row into the results file keyed by config id, so subset re-runs update
// rather than clobber earlier rows
function record_result(entry:ConfigResult):void {
    const results:ConfigResult[] = existsSync(results_file)
        ? JSON.parse(readFileSync(results_file, 'utf-8')) as ConfigResult[]
        : []
    const index = results.findIndex(row => row.config === entry.config)
    if (index === -1){
        results.push(entry)
    } else {
        results[index] = entry
    }
    writeFileSync(results_file, JSON.stringify(results, null, 4))
}


// Run every config sequentially, recording results after each so a crash still leaves data
async function main():Promise<void> {
    mkdirSync(results_dir, {recursive: true})

    for (const config of get_configs()){
        console.log(`config ${config.id} (${config.note})...`)

        // Track the typst CLI child (spawned per compile) and this node process itself
        const typst_poll = start_rss_poll(/\.bin\/typst compile/)
        let node_peak = process.memoryUsage().rss
        const node_timer = setInterval(() => {
            node_peak = Math.max(node_peak, process.memoryUsage().rss)
        }, 100)

        const started = Date.now()
        const tier = {id: config.id, books: config.books}
        const blueprint = build_blueprint(tier, config.overrides)

        // Fresh BibleContent per config (none passed in), matching a cold server instance
        let entry:ConfigResult
        try {
            const bytes = await compile_pdf_from_blueprint(blueprint, compile_options)
            writeFileSync(join(results_dir, `matrix_${config.id}.pdf`), bytes)
            entry = {
                config: config.id,
                note: config.note,
                books: config.books.length,
                ok: true,
                total_ms: Date.now() - started,
                pages: (await PDFDocument.load(bytes)).getPageCount(),
                pdf_mb: Math.round(bytes.length / 1048576 * 100) / 100,
                typst_peak_mb: 0,
                node_peak_mb: 0,
            }
        } catch (error){
            entry = {
                config: config.id,
                note: config.note,
                books: config.books.length,
                ok: false,
                total_ms: Date.now() - started,
                typst_peak_mb: 0,
                node_peak_mb: 0,
                error: String(error),
            }
        }
        clearInterval(node_timer)
        entry.typst_peak_mb = typst_poll.stop()
        entry.node_peak_mb = Math.round(node_peak / 1048576)

        console.log(JSON.stringify(entry))
        record_result(entry)
    }
}


await main()
