
import path from 'node:path'

import plugin_vue from '@vitejs/plugin-vue'
import plugin_vuetify from 'vite-plugin-vuetify'
import plugin_svg_loader from 'vite-svg-loader'
import {defineConfig} from 'vite'

import plugin_index from './vite_plugin_index.mts'


export default defineConfig(() => {
    return {
        clearScreen: false,
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
