
import path from 'node:path'
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
        server: {
            fs: {
                strict: true,
            },
            // Same-origin path to the local API server (mirrors CloudFront's /api/* cache
            // behavior in production — see .bin/serve_server)
            proxy: {
                '/api': 'http://localhost:8788',
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
    }
})
