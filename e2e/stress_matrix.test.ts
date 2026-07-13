
// Browser-side runner for the layout-option stress matrix (see matrix.ts): compiles each
// config through the WASM worker exactly like stress_wasm.test.ts does for the size tiers.
// Results merge into e2e/results/matrix_wasm.json (+ each config's PDF).
//
// Run via `.bin/test_e2e stress_matrix.test.ts`; STRESS_CONFIGS="psa_col1,..." runs a subset.

import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'

import {test} from '@playwright/test'
import {PDFDocument} from 'pdf-lib'

import {build_blueprint} from './tiers'
import {get_configs} from './matrix'
import {start_rss_poll, sample_rss_kb} from './rss'

import type {Blueprint} from 'paper-bible-typst'


// What page_harness.js returns for one config
interface HarnessOutcome {
    ok:boolean
    stage?:'resolve'|'compile'
    resolve_ms?:number
    compile_ms?:number
    pdf_base64?:string
    error?:string
}

// The harness module injected into each config's page (see page_harness.js)
declare global {
    interface Window {
        __stress:{run_tier:(blueprint:Blueprint, assets_prefix:string)=>Promise<HarnessOutcome>}
    }
}

// One row of the results file
interface ConfigResult {
    config:string
    note:string
    books:number
    ok:boolean
    total_ms:number
    resolve_ms?:number
    compile_ms?:number
    pages?:number
    pdf_mb?:number
    renderer_baseline_mb:number
    renderer_peak_mb:number
    stage?:string
    error?:string
}


// Renderer processes of the project-local browser install (the worker that runs the WASM
// compiler lives inside the page's renderer process)
const RENDERER = /e2e\/browsers.*--type=renderer/


// Merge a finished row into the results file keyed by config id, so subset re-runs update
// rather than clobber earlier rows
function record_result(results_file:string, entry:ConfigResult):void {
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


test('wasm compile stress matrix', async ({browser}) => {
    // The full matrix takes as long as it takes — configs are watched individually below
    test.setTimeout(0)

    const e2e_dir = test.info().config.rootDir
    const results_dir = join(e2e_dir, 'results')
    mkdirSync(results_dir, {recursive: true})
    const results_file = join(results_dir, 'matrix_wasm.json')
    const harness = readFileSync(join(e2e_dir, 'page_harness.js'), 'utf-8')
    const assets_prefix = 'http://localhost:5300/generator_assets/'

    // Run every config even after a failure — how each one fails is exactly the data wanted
    for (const config of get_configs()){

        // Fresh context/page per config: fresh renderer process, fresh worker, no carryover
        const context = await browser.newContext()
        const page = await context.newPage()

        // Blank same-origin document, so module imports hit the Vite dev server without
        // booting the whole app
        await page.route('**/__stress__', route => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><title>stress</title>',
        }))
        await page.goto('/__stress__')
        await page.addScriptTag({type: 'module', content: harness})
        await page.waitForFunction(() => Boolean(window.__stress))

        // Compile while sampling the renderer's memory from outside the browser
        const baseline_mb = Math.round(sample_rss_kb(RENDERER) / 1024)
        const poll = start_rss_poll(RENDERER)
        const started = Date.now()
        const tier = {id: config.id, books: config.books}
        let outcome:HarnessOutcome
        try {
            outcome = await page.evaluate(async args => {
                return window.__stress.run_tier(args.blueprint, args.assets_prefix)
            }, {blueprint: build_blueprint(tier, config.overrides), assets_prefix})
        } catch (error){
            // The renderer itself died (hard OOM) — still a valid stress result
            outcome = {ok: false, stage: 'compile', error: `Page crashed: ${String(error)}`}
        }
        const total_ms = Date.now() - started
        const peak_mb = poll.stop()
        await context.close()

        // Record the config (decode + save the PDF when the compile succeeded)
        const entry:ConfigResult = {
            config: config.id,
            note: config.note,
            books: config.books.length,
            ok: outcome.ok,
            total_ms,
            resolve_ms: outcome.resolve_ms,
            compile_ms: outcome.compile_ms,
            renderer_baseline_mb: baseline_mb,
            renderer_peak_mb: peak_mb,
        }
        if (outcome.ok && outcome.pdf_base64){
            const bytes = Buffer.from(outcome.pdf_base64, 'base64')
            writeFileSync(join(results_dir, `matrix_wasm_${config.id}.pdf`), bytes)
            entry.pages = (await PDFDocument.load(bytes)).getPageCount()
            entry.pdf_mb = Math.round(bytes.length / 1048576 * 100) / 100
        } else {
            entry.stage = outcome.stage
            entry.error = outcome.error
        }
        console.log(JSON.stringify(entry))
        record_result(results_file, entry)
    }
})
