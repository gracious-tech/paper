
import {fileURLToPath} from 'node:url'

import {defineConfig} from 'vitest/config'


// This file's own directory (app/) — .mts is ESM, so there is no __dirname
const here = fileURLToPath(new URL('.', import.meta.url))


// Unit tests for the app's *service* logic only — the pure and near-pure modules under
// src/services. There are deliberately no component tests: the components are Pug + Vuetify and
// would need a DOM, a Vuetify instance and far more mocking than the assertions would be worth.
//
// Two service modules are aliased to test doubles rather than mocked per file: `content` owns a
// live fetch-client and is null until the app boots, and `state` is the open design's reactive
// singleton. Almost every service touches one of them, and a shared double keeps each suite to
// what it is actually testing. Anything else is imported for real.
export default defineConfig({
    resolve: {
        alias: [
            // Most specific first — Vite takes the first alias that matches
            {
                find: '@/services/content',
                replacement: `${here}tests/stubs/content.ts`,
            },
            {
                find: '@/services/state',
                replacement: `${here}tests/stubs/state.ts`,
            },
            {
                find: '@',
                replacement: `${here}src`,
            },
        ],
    },
    test: {
        include: ['tests/**/*.test.ts'],
    },
})
