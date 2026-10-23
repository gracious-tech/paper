
// Coverage from the Playwright journeys: Chromium's own V8 coverage of each page, via the
// auto fixture in e2e/fixtures.ts, turned into one raw export once every worker is done (the
// config's globalTeardown). Only on a coverage run (COVERAGE=1, see .bin/audit_coverage).
//
// What this can't see: Web Workers (the Typst compiler, the cover renderer), whose scripts
// page.coverage doesn't report, and pages that closed before their test ended. The API server
// the journeys talk to is covered separately (child_coverage_env() in playwright.config.ts)

import {MCR} from 'monocart-coverage-reports'

import {RAW_DIR, REPORTS_DIR, shared_options} from './scope.ts'

import type {BrowserContext, Page} from '@playwright/test'


// Whether this run collects coverage
export const COLLECTING = process.env['COVERAGE'] === '1'

// Where every worker's data accumulates (MCR's .cache) until the teardown merges it
const WORK_DIR = `${REPORTS_DIR}work/e2e`


// Start recording a page's coverage, before anything navigates it
async function start(page:Page):Promise<void>{
    await page.coverage.startJSCoverage({resetOnNavigation: false, reportAnonymousScripts: false})
}


// Record coverage for every page a test's context opens, and hand back a function that collects
// it all once the test is done. Each worker adds to the shared cache; none generates or cleans
export async function record_context(context:BrowserContext):Promise<() => Promise<void>>{
    const started = new Set<Page>()
    const begin = (page:Page) => {
        started.add(page)
        return start(page)
    }
    context.on('page', page => void begin(page))
    await Promise.all(context.pages().map(begin))

    return async () => {
        const open = [...started].filter(page => !page.isClosed())
        const entries = (await Promise.all(open.map(page => page.coverage.stopJSCoverage())))
            .flat()
        if (entries.length){
            await MCR({...shared_options(), outputDir: WORK_DIR}).add(entries)
        }
    }
}


// Turn what the workers collected into the run's raw export (Playwright's globalTeardown)
export default async function generate():Promise<void>{
    if (!COLLECTING){
        return
    }
    const results = await MCR({
        ...shared_options(),
        outputDir: WORK_DIR,
        reports: [['raw', {outputDir: `${RAW_DIR}e2e`}]],
    }).generate()
    if (!results){
        throw new Error('The journeys collected no coverage')
    }
}
