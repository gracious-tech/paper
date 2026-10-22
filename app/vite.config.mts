
import path from 'node:path'
import {readFileSync} from 'node:fs'
import {execSync} from 'node:child_process'

import plugin_vue from '@vitejs/plugin-vue'
import plugin_vuetify from 'vite-plugin-vuetify'
import plugin_svg_loader from 'vite-svg-loader'
import {defineConfig} from 'vite'

import plugin_index from './vite_plugin_index.mts'


function build_commit():string{
    // The commit this build was made from, stamped onto every error report so .bin/audit_errors
    // can tell reports from builds that predate a fix from genuine regressions. Same format as
    // the server image's tag (see .bin/build_server_lambda): short hash, '-dirty' if the tracked
    // tree had uncommitted changes
    try {
        const hash = execSync('git rev-parse --short HEAD', {encoding: 'utf8'}).trim()
        const dirty = execSync('git status --porcelain --untracked-files=no', {encoding: 'utf8'})
        return dirty.trim() ? `${hash}-dirty` : hash
    } catch {
        return 'unknown'
    }
}


function emulator_ports():{auth:number, firestore:number, storage:number}{
    // The emulator ports the app connects to in dev, read from the emulator config the stack was
    // started with — firebase.json for the dev stack, EMULATOR_CONFIG for anything else (the e2e
    // journeys run their own emulators on firebase_e2e.json's ports, see e2e/playwright.config.ts)
    const file = path.resolve(import.meta.dirname, '..',
        process.env['EMULATOR_CONFIG'] ?? 'firebase.json')
    const emulators = (JSON.parse(readFileSync(file, 'utf8')) as {emulators:Record<string,
        {port:number}>}).emulators
    return {
        auth: emulators['auth']!.port,
        firestore: emulators['firestore']!.port,
        storage: emulators['storage']!.port,
    }
}


export default defineConfig(({command}) => {

    // Whether to use the production fetch.bible, shared assets, cover widget and story images
    // rather than their local dev servers — always for a build, and for dev only when
    // USE_PROD_SERVICES=true (see .bin/serve_simple). Firebase is unaffected (always emulated)
    const use_prod_services = command === 'build' || process.env['USE_PROD_SERVICES'] === 'true'

    return {
        clearScreen: false,
        define: {
            'import.meta.env.USE_PROD_SERVICES': JSON.stringify(use_prod_services),
            'import.meta.env.BUILD_COMMIT': JSON.stringify(
                command === 'build' ? build_commit() : 'dev'),
            'import.meta.env.EMULATOR_PORTS': JSON.stringify(emulator_ports()),
        },
        plugins: [
            plugin_index(path.join(import.meta.dirname, 'src/index.pug')),
            plugin_vue(),
            plugin_vuetify({autoImport: true}),
            plugin_svg_loader(),
        ],
        resolve: {
            alias: [
                {
                    find: '@',
                    replacement: path.resolve(import.meta.dirname, 'src'),
                },
            ],
        },
        css: {
            devSourcemap: true,  // Include source map when injecting CSS in JS
        },
        optimizeDeps: {
            // Where the dev server's dependency scan starts. It would otherwise crawl
            // index.html, which is only a placeholder (plugin_index renders index.pug), and so
            // find nothing — every dependency was then discovered as the browser requested it,
            // each discovery re-bundling and reloading the page mid-use. The workers are listed
            // too, since the scan doesn't follow `new Worker(new URL(...))`
            entries: ['src/init.ts', 'src/services/typst_worker.ts', 'src/services/cover_worker.ts'],
            // Nor does it see the component imports plugin_vuetify's autoImport writes into
            // templates as it transforms them, so those are bundled up front as well
            include: ['vuetify/components/*', 'vuetify/directives'],
        },
        server: {
            fs: {
                strict: true,
            },
            // Same-origin path to the local API server (mirrors CloudFront's /api/* cache
            // behavior in production — see .bin/serve_server). API_PORT moves it for a second
            // stack, as the e2e journeys run
            proxy: {
                '/api': `http://localhost:${process.env['API_PORT'] ?? 8788}`,
            },
        },
        build: {
            target: 'es2018',  // Currently supporting browsers ES2015+
            cssTarget: 'safari10',  // Prevent things like top/left/bottom/right -> 'inset'
            // 'hidden': emit .map files (for .bin/audit_errors to symbolicate stack traces
            // with, see .bin/deploy_app) without a sourceMappingURL comment in the bundle,
            // so end users' browsers never fetch original source
            sourcemap: 'hidden',
        },
        worker: {
            // Both workers are module workers (`{type: 'module'}`), so emit ES rather than the
            // default IIFE, which can't code-split: bookcover-core's lazily imported vector
            // designs would otherwise all be inlined into the cover worker's one chunk
            format: 'es',
        },
    }
})
