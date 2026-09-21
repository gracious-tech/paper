
// Point the Admin SDK at the test emulators before any suite imports server/src/firebase.ts —
// that module initialises the app at import time, so the env vars have to be in place first.
// The client-side rules suites are unaffected: rules-unit-testing is given host/port explicitly.

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'


const config = JSON.parse(readFileSync(
    fileURLToPath(new URL('../firebase_test.json', import.meta.url)), 'utf8')) as
    {emulators:{auth:{port:number}, firestore:{port:number}, storage:{port:number}}}


// The project every suite shares — deliberately not the dev project, so nothing here can reach
// the emulator data .bin/serve_emulators persists
export const TEST_PROJECT = 'paper-bible-test'

process.env['GCLOUD_PROJECT'] = TEST_PROJECT
process.env['FIREBASE_AUTH_EMULATOR_HOST'] = `127.0.0.1:${config.emulators.auth.port}`
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${config.emulators.firestore.port}`
process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = `127.0.0.1:${config.emulators.storage.port}`
