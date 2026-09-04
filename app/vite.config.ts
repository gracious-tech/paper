
import path from 'node:path'

import plugin_vue from '@vitejs/plugin-vue'
import plugin_vuetify from 'vite-plugin-vuetify'
import plugin_svg_loader from 'vite-svg-loader'
import {defineConfig} from 'vite'

import plugin_index from './vite_plugin_index'


export default defineConfig(({mode}) => {
    return {
        clearScreen: false,
        plugins: [
            plugin_index(path.join(__dirname, 'src/index.pug')),
            plugin_vue(),
            plugin_vuetify({autoImport: true}),
            plugin_svg_loader(),
        ],
        resolve: {
            alias: [
                {
                    find: '@',
                    replacement: path.resolve(__dirname, 'src'),
                },
            ],
        },
        css: {
            devSourcemap: true,  // Include source map when injecting CSS in JS
            preprocessorOptions: {
                sass: {
                    // Shared-assets base URL for stylesheets (fonts etc) — same dev/prod
                    // switch as ASSETS_PREFIX in services/typst.ts, but Sass can't read
                    // import.meta.env so it's injected as a variable here instead
                    additionalData: `$assets_prefix: "${mode === 'development'
                        ? 'http://localhost:5301/generator_assets/'
                        : 'https://assets.paper.bible/'}"\n`,
                },
            },
        },
        server: {
            fs: {
                strict: true,
            },
            // Same-origin path to the local API server (mirrors Hosting's /api/** rewrite to
            // Cloud Run in production — see .bin/serve_server)
            proxy: {
                '/api': 'http://localhost:8788',
            },
        },
        build: {
            target: 'es2018',  // Currently supporting browsers ES2015+
            cssTarget: 'safari10',  // Prevent things like top/left/bottom/right -> 'inset'
        },
    }
})
