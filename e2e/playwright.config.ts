
// Playwright config for e2e + stress runs. Expects the local dev stack to already be running:
// .bin/serve_emulators, .bin/serve_server and .bin/serve_app (see CLAUDE.md), plus the dev
// Bible-content server on :8430. Run via .bin/test_e2e so the project-local browser dir
// (.playwright-browsers/) is used.

import {defineConfig} from '@playwright/test'


export default defineConfig({
    testDir: '.',
    outputDir: './results/artifacts',
    // Stress tiers legitimately take many minutes; the stress spec manages its own timeout
    timeout: 10 * 60 * 1000,
    // One worker so memory measurements never overlap between tests
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5300',
        launchOptions: {
            // Chromium blocks localhost fetches from pages whose document was synthesized via
            // route.fulfill (local-network-access checks) — the stress harness needs :8430
            args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,'
                + 'BlockInsecurePrivateNetworkRequests'],
        },
    },
})
