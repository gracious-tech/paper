
// The API server for the journeys' stack, run by `firebase emulators:exec` once the emulators
// are up (see playwright.config.ts). The same dev entry point .bin/serve_server runs, with the
// stack's ports set before the server's config module reads them.
//
// The emulator hosts are set here even though emulators:exec sets them too, because exec names
// 127.0.0.1 and the app names localhost: the server and the app each build an image's public
// Storage URL into a frozen blueprint, and the two must come out byte-identical

import {API_PORT, EMULATOR_PORTS, PROJECT, ROOT} from './stack.ts'


process.env['GCLOUD_PROJECT'] = PROJECT
process.env['FIREBASE_AUTH_EMULATOR_HOST'] = `localhost:${EMULATOR_PORTS.auth}`
process.env['FIRESTORE_EMULATOR_HOST'] = `localhost:${EMULATOR_PORTS.firestore}`
process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = `localhost:${EMULATOR_PORTS.storage}`
process.env['PORT'] = String(API_PORT)
process.env['FETCH_ENDPOINT'] = 'https://v1.fetch.bible/'
// Only the compile role reads these, and no journey compiles on the server — the browser does
process.env['TYPST_PATH'] = `${ROOT}.bin/typst`
process.env['ASSETS_DIR'] = `${ROOT}assets`

await import('../server/src/dev_server.ts')
