
// The stack the journeys run against, which Playwright starts itself (see playwright.config.ts)
// so a run needs nothing else up: Firebase emulators on firebase_e2e.json's ports, the API server
// against them, and the app's Vite dev server. Its own ports throughout, so it runs alongside
// the dev stack rather than in place of it.
//
// Outside content is production's, as .bin/serve_simple does it (USE_PROD_SERVICES): Bible text
// from fetch.bible, fonts and the Typst WASM from assets.paper.bible, the cover widget from
// cover-widget.paper.bible. Those are public and read-only, so a run can't change them, and none
// of their local dev servers (other repos) has to be running

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'


// The repo root, which every command and path below is relative to
export const ROOT = fileURLToPath(new URL('..', import.meta.url))

// The emulator config, and the project id the app's own Firebase config names
export const EMULATOR_CONFIG = 'firebase_e2e.json'
export const PROJECT = 'paper-bible'
export const BUCKET = `${PROJECT}.firebasestorage.app`

// The emulators' ports, read from the config so they can't drift from it
const emulators = (JSON.parse(readFileSync(`${ROOT}${EMULATOR_CONFIG}`, 'utf8')) as
    {emulators:Record<'auth'|'firestore'|'storage', {port:number}>}).emulators
export const EMULATOR_PORTS = {
    auth: emulators.auth.port,
    firestore: emulators.firestore.port,
    storage: emulators.storage.port,
}

// The app (Vite) and the API server it proxies /api to
export const APP_PORT = 5310
export const API_PORT = 8790
export const APP_URL = `http://localhost:${APP_PORT}`

// The Storage emulator's public download URL for an object, as the app builds it
// (storage_public_url in app/src/services/design_assets.ts)
export function storage_url(path:string):string{
    return `http://localhost:${EMULATOR_PORTS.storage}/v0/b/${BUCKET}/o/`
        + `${encodeURIComponent(path)}?alt=media`
}
