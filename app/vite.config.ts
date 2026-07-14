
import path from 'node:path'

import plugin_vue from '@vitejs/plugin-vue'
import plugin_vuetify from 'vite-plugin-vuetify'
import plugin_svg_loader from 'vite-svg-loader'
import {defineConfig} from 'vite'

import plugin_index from './vite_plugin_index'
import plugin_fonts from './vite_plugin_fonts'


export default defineConfig(({mode}) => {
    return {
        publicDir: 'src/public',
        clearScreen: false,
        plugins: [
            plugin_index(path.join(__dirname, 'src/index.pug')),
            plugin_fonts(path.join(__dirname, '../fonts')),
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
