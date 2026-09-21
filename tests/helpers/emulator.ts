
// Shared setup for the emulator-backed suites: one RulesTestEnvironment per test file, plus the
// document/object fixtures the rules are checked against.
//
// Ports come from firebase_test.json rather than firebase.json — the rules suites clear Firestore
// between cases, which against the dev emulator would delete whatever the developer was working
// on (see .bin/audit_unit)

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {initializeTestEnvironment} from '@firebase/rules-unit-testing'
import {doc, setDoc, serverTimestamp} from 'firebase/firestore'
import {ref, listAll, deleteObject} from 'firebase/storage'

import type {RulesTestEnvironment, RulesTestContext} from '@firebase/rules-unit-testing'
import type {Firestore} from 'firebase/firestore'
import type {FirebaseStorage, StorageReference} from 'firebase/storage'


// Emulator ports, read from the test config so there is one place to change them
const test_config = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../firebase_test.json', import.meta.url)), 'utf8')) as
    {emulators:{firestore:{port:number}, storage:{port:number}}}

export const FIRESTORE_PORT = test_config.emulators.firestore.port
export const STORAGE_PORT = test_config.emulators.storage.port


// A repo-root-relative file's contents
function read_root(path:string):string {
    return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
}


export async function make_test_env():Promise<RulesTestEnvironment>{
    // Bring up a rules test environment against the already-running test emulators, loading both
    // rules files so a storage test can still resolve its firestore.get() of the design doc
    return await initializeTestEnvironment({
        projectId: 'paper-bible-test',
        firestore: {
            rules: read_root('firestore.rules'),
            host: '127.0.0.1',
            port: FIRESTORE_PORT,
        },
        storage: {
            rules: read_root('firebase_storage.rules'),
            host: '127.0.0.1',
            port: STORAGE_PORT,
        },
    })
}


// The uids the suites use. `owner` creates things, `editor` is invited to them, `stranger` is
// anyone else who knows (or guesses) an id
export const OWNER = 'uid_owner'
export const EDITOR = 'uid_editor'
export const STRANGER = 'uid_stranger'


export function db_for(env:RulesTestEnvironment, uid:string|null):Firestore{
    // A Firestore handle acting as the given user (null = signed out)
    const context:RulesTestContext =
        uid === null ? env.unauthenticatedContext() : env.authenticatedContext(uid)
    return context.firestore()
}


export function storage_for(env:RulesTestEnvironment, uid:string|null):FirebaseStorage{
    // A Storage handle acting as the given user (null = signed out)
    const context:RulesTestContext =
        uid === null ? env.unauthenticatedContext() : env.authenticatedContext(uid)
    return context.storage()
}


// A design doc's fields, as the app writes them. Only the fields the rules actually read matter,
// but the rest are kept realistic so a test reads like the real thing
export function design_data(overrides:Record<string, unknown> = {}):Record<string, unknown>{
    return {
        schema: 1,
        owner: OWNER,
        editor_uids: [OWNER],
        editors: {},
        share_token: 'share_token_value',
        name: 'My design',
        name_auto: 'Genesis',
        save_token: 'save_token_value',
        created: serverTimestamp(),
        modified: serverTimestamp(),
        category: null,
        latest_version: null,
        blueprint: {font_size: 10},
        content_items: {},
        content_order: [],
        fonts: {},
        wizard_draft: null,
        simple_mode: false,
        ...overrides,
    }
}


// A version doc's fields at create time. `created` must be request.time and `pdf_path` must follow
// the convention, both pinned by the rules — so the id has to be known in advance
export function version_data(version_id:string,
        overrides:Record<string, unknown> = {}):Record<string, unknown>{
    return {
        schema: 1,
        design_id: 'design_main',
        owner: OWNER,
        created: serverTimestamp(),
        compile_started: serverTimestamp(),
        title: 'Genesis',
        status: 'pending',
        pages: null,
        error: null,
        error_id: null,
        blueprint: {font_size: 10},
        pdf_path: `versions/${version_id}/doc.pdf`,
        pdf_expires: null,
        cover_status: null,
        cover_render_version: null,
        copied_from: null,
        save_token: 'save_token_value',
        custom_fonts: [],
        wizard_draft: null,
        simple_mode: false,
        ...overrides,
    }
}


async function delete_recursively(directory:StorageReference):Promise<void>{
    // Remove every object at or below a prefix (listAll only reports one level at a time)
    const listing = await listAll(directory)
    await Promise.all([
        ...listing.items.map(item => deleteObject(item)),
        ...listing.prefixes.map(prefix => delete_recursively(prefix)),
    ])
}


export async function clear_storage(env:RulesTestEnvironment):Promise<void>{
    // Empty the bucket between tests.
    //
    // Not env.clearStorage(): that deletes only the objects listAll() reports at the bucket root
    // and never descends into prefixes, so every object this app writes (all of them nested under
    // design_assets/, version_assets/, design_cache/ or versions/) would survive it — and a
    // leftover object silently inverts the create-once rules, which deny a second write by design
    await env.withSecurityRulesDisabled(async context => {
        await delete_recursively(ref(context.storage()))
    })
}


export async function seed(env:RulesTestEnvironment,
        writes:{path:string, data:Record<string, unknown>}[]):Promise<void>{
    // Write documents with the rules bypassed, so a test can set up state the rules themselves
    // would forbid a client from creating (another user's design, an already-available version)
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore()
        for (const write of writes){
            await setDoc(doc(db, write.path), write.data)
        }
    })
}
