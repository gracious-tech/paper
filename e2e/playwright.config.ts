// Playwright config for the e2e journeys + stress runs. Starts its own stack (see stack.ts), so a
// run needs no dev servers — Firebase emulators, the API server and the app all come up here,
// on ports of their own. Run via .bin/audit_e2e (journeys) or .bin/audit_stress, so the
// project-local browser dir (e2e/browsers/) is used.

import {mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'

import {defineConfig, devices} from '@playwright/test'

import {API_PORT, APP_PORT, APP_URL, EMULATOR_CONFIG, PROJECT, ROOT} from './stack.ts'
import {child_coverage_env} from '../coverage/scope.ts'


const CI = !!process.env['CI']

// A stack already listening can be reused, except by a coverage run: its API server wouldn't be
// collecting any
const REUSE = !CI && process.env['COVERAGE'] !== '1'

// The emulators' temp dir: every Storage emulator keeps its files in <temp>/firebase/storage/blobs
// and empties it on start, so this stack gets one of its own rather than wiping the dev or test
// stack's (one per stack suffices, since its ports already stop two running at once)
const EMULATOR_TMP = `${tmpdir()}/paper-bible-e2e`
mkdirSync(EMULATOR_TMP, {recursive: true})


export default defineConfig({
    testDir: '.',
    outputDir: './results/artifacts',
    // A journey that hangs should say so promptly; the compile and stress specs set their own
    timeout: 2 * 60 * 1000,
    expect: {timeout: 15_000},
    // Production content services sit between every run and green, so CI gives a failure one
    // more go before calling it — a flake then shows as "flaky" in the report rather than red
    retries: CI ? 1 : 0,
    forbidOnly: CI,
    // On a coverage run, turns what every worker collected into one raw export (coverage/e2e.ts)
    globalTeardown: '../coverage/e2e.ts',
    reporter: CI ? [['list'], ['html', {open: 'never', outputFolder: './results/report'}]]
        : [['list']],
    use: {
        baseURL: APP_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            // Chromium blocks localhost fetches from pages whose document was synthesized via
            // route.fulfill (local-network-access checks), which the stress harness relies on
            args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,'
                + 'BlockInsecurePrivateNetworkRequests'],
        },
    },
    projects: [
        {
            // Everything a user does, at the desktop layout (editor beside the preview pane)
            name: 'journeys',
            testIgnore: [/stress_/, /mobile\.test\.ts/],
            use: {viewport: {width: 1400, height: 900}},
        },
        {
            // The layout below AppRoot's 900px breakpoint, where there's no preview pane
            name: 'mobile',
            testMatch: /mobile\.test\.ts/,
            use: {...devices['Pixel 7'], browserName: 'chromium'},
        },
        {
            // Compile stress measurements (not run by default — see .bin/audit_stress). One at
            // a time, so memory readings never overlap
            name: 'stress',
            testMatch: /stress_.*\.test\.ts/,
            workers: 1,
        },
    ],
    webServer: [
        {
            // The emulators, then the API server once they're ready — emulators:exec only runs
            // its command after every emulator is up, so the server's health route answering
            // means the whole backend is
            command: `npx firebase emulators:exec --config ${EMULATOR_CONFIG}`
                + ` --project ${PROJECT} --only auth,firestore,storage 'node e2e/api_server.ts'`,
            cwd: ROOT,
            url: `http://localhost:${API_PORT}/api/health`,
            // The server's coverage too, on a coverage run (the browser's is the fixtures')
            env: {FIREBASE_EMULATORS_PATH: `${ROOT}.emulator_cache`, TMPDIR: EMULATOR_TMP,
                ...child_coverage_env()},
            reuseExistingServer: REUSE,
            timeout: 3 * 60 * 1000,
            // Lets the emulators shut their Java processes down rather than orphaning them
            gracefulShutdown: {signal: 'SIGINT', timeout: 15_000},
            stdout: 'ignore',
            stderr: 'pipe',
        },
        {
            // The app, against those emulators and production's content services
            command: `npx vite --port ${APP_PORT} --strictPort`,
            cwd: `${ROOT}app`,
            url: APP_URL,
            env: {
                USE_PROD_SERVICES: 'true',
                EMULATOR_CONFIG,
                API_PORT: String(API_PORT),
            },
            reuseExistingServer: REUSE,
            timeout: 2 * 60 * 1000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],
})
