
// Stress the in-browser (WASM worker) compile path with ever-larger documents, recording
// timing, output size and browser renderer memory per tier. Results land in e2e/results/
// (wasm.json + each tier's PDF) for comparison with stress_server.ts — together they show how
// likely the server fallback is to be needed at each document size.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {test} from '@playwright/test'
import {PDFDocument} from 'pdf-lib'

import {get_tiers, build_blueprint} from './tiers'
import {start_rss_poll, sample_rss_kb} from './rss'

import type {Blueprint} from 'paper-bible-typst'


// What page_harness.js returns for one tier
interface HarnessOutcome {
    ok:boolean
    stage?:'resolve'|'compile'
    resolve_ms?:number
    compile_ms?:number
    pdf_base64?:string
    error?:string
}

// The harness module injected into each tier's page (see page_harness.js)
declare global {
    interface Window {
        __stress:{run_tier:(blueprint:Blueprint, assets_prefix:string)=>Promise<HarnessOutcome>}
    }
}

// One row of the results file
interface TierResult {
    tier:string
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


test('wasm compile stress tiers', async ({browser}) => {
    // The full ladder takes as long as it takes — tiers are watched individually below
    test.setTimeout(0)

    const e2e_dir = test.info().config.rootDir
    const results_dir = join(e2e_dir, 'results')
    mkdirSync(results_dir, {recursive: true})
    const harness = readFileSync(join(e2e_dir, 'page_harness.js'), 'utf-8')
    const assets_prefix = 'http://localhost:5300/generator_assets/'

    // Run every tier even after a failure — how each size fails is exactly the data wanted
    const results:TierResult[] = []
    for (const tier of get_tiers()){

        // Fresh context/page per tier: fresh renderer process, fresh worker, no WASM carryover
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
        let outcome:HarnessOutcome
        try {
            outcome = await page.evaluate(async args => {
                return window.__stress.run_tier(args.blueprint, args.assets_prefix)
            }, {blueprint: build_blueprint(tier), assets_prefix})
        } catch (error){
            // The renderer itself died (hard OOM) — still a valid stress result
            outcome = {ok: false, stage: 'compile', error: `Page crashed: ${String(error)}`}
        }
        const total_ms = Date.now() - started
        const peak_mb = poll.stop()
        await context.close()

        // Record the tier (decode + save the PDF when the compile succeeded)
        const entry:TierResult = {
            tier: tier.id,
            books: tier.books.length,
            ok: outcome.ok,
            total_ms,
            resolve_ms: outcome.resolve_ms,
            compile_ms: outcome.compile_ms,
            renderer_baseline_mb: baseline_mb,
            renderer_peak_mb: peak_mb,
        }
        if (outcome.ok && outcome.pdf_base64){
            const bytes = Buffer.from(outcome.pdf_base64, 'base64')
            writeFileSync(join(results_dir, `wasm_${tier.id}.pdf`), bytes)
            entry.pages = (await PDFDocument.load(bytes)).getPageCount()
            entry.pdf_mb = Math.round(bytes.length / 1048576 * 100) / 100
        } else {
            entry.stage = outcome.stage
            entry.error = outcome.error
        }
        results.push(entry)
        console.log(JSON.stringify(entry))

        // Persist after every tier so a crashed run still leaves its data behind (custom
        // STRESS_BOOKS probes get their own file so they never clobber a full ladder run)
        const results_file = process.env['STRESS_BOOKS'] ? 'wasm_custom.json' : 'wasm.json'
        writeFileSync(join(results_dir, results_file), JSON.stringify(results, null, 4))
    }
})
