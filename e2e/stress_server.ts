
// Stress the server compile path with the same document tiers as stress_wasm.test.ts: the
// exact pipeline the Cloud Run fallback runs (BibleContent resolve → Typst CLI), measuring
// wall time plus peak typst/node memory — the numbers to hold against the compile service's
// 2Gi limit. Writes e2e/results/server.json (+ each tier's PDF).
//
// Run with `node e2e/stress_server.ts` (needs the dev content server on :8430, the typst CLI
// from .bin/setup_typst, and the assets/ tree from the bookcover repo).

import {mkdirSync, writeFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

import {PDFDocument} from 'pdf-lib'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'

import {get_tiers, build_blueprint} from './tiers.ts'
import {start_rss_poll} from './rss.ts'

import type {ProgressEvent} from 'paper-bible-typst-node'


// One row of the results file
interface TierResult {
    tier:string
    books:number
    ok:boolean
    total_ms:number
    pages?:number
    pdf_mb?:number
    typst_peak_mb:number
    node_peak_mb:number
    error?:string
    // Coarse pipeline timeline (progress events with ms offsets), to split fetch vs compile
    events:{ms:number, stage:string, label?:string}[]
}


const e2e_dir = dirname(fileURLToPath(import.meta.url))
const root = dirname(e2e_dir)
const results_dir = join(e2e_dir, 'results')

// Same setup .bin/serve_server gives the local API server (which mirrors Cloud Run)
const compile_options = {
    typst_path: join(root, '.bin', 'typst'),
    fonts_dir: join(root, 'assets/fonts'),
    endpoint: 'http://localhost:8430/',
}


// Run every tier sequentially, recording results after each so a crash still leaves data
async function main():Promise<void> {
    mkdirSync(results_dir, {recursive: true})
    const results:TierResult[] = []

    for (const tier of get_tiers()){
        console.log(`tier ${tier.id} (${tier.books.length} books)...`)

        // Track the typst CLI child (spawned per compile) and this node process itself
        const typst_poll = start_rss_poll(/\.bin\/typst compile/)
        let node_peak = process.memoryUsage().rss
        const node_timer = setInterval(() => {
            node_peak = Math.max(node_peak, process.memoryUsage().rss)
        }, 100)

        const started = Date.now()
        const events:TierResult['events'] = []
        const on_progress = (event:ProgressEvent) => {
            events.push({ms: Date.now() - started, stage: event.stage, label: event.label})
        }

        // Fresh BibleContent per tier (none passed in), matching a cold server instance
        let entry:TierResult
        try {
            const bytes = await compile_pdf_from_blueprint(build_blueprint(tier),
                {...compile_options, on_progress})
            writeFileSync(join(results_dir, `server_${tier.id}.pdf`), bytes)
            entry = {
                tier: tier.id,
                books: tier.books.length,
                ok: true,
                total_ms: Date.now() - started,
                pages: (await PDFDocument.load(bytes)).getPageCount(),
                pdf_mb: Math.round(bytes.length / 1048576 * 100) / 100,
                typst_peak_mb: 0,
                node_peak_mb: 0,
                events,
            }
        } catch (error){
            entry = {
                tier: tier.id,
                books: tier.books.length,
                ok: false,
                total_ms: Date.now() - started,
                typst_peak_mb: 0,
                node_peak_mb: 0,
                error: String(error),
                events,
            }
        }
        clearInterval(node_timer)
        entry.typst_peak_mb = typst_poll.stop()
        entry.node_peak_mb = Math.round(node_peak / 1048576)

        results.push(entry)
        console.log(JSON.stringify({...entry, events: undefined}))
        // Custom STRESS_BOOKS probes get their own file so they never clobber a ladder run
        const results_file = process.env['STRESS_BOOKS'] ? 'server_custom.json' : 'server.json'
        writeFileSync(join(results_dir, results_file), JSON.stringify(results, null, 4))
    }
}


await main()
