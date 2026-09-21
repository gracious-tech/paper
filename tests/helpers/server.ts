
// Admin-side fixtures for the server handler suites.
//
// These exercise the handlers directly (not over HTTP) because that is where the authorisation
// decisions live: the Admin SDK bypasses the security rules entirely, so every check a client
// route relies on is written in code here and nowhere else. The one exception is the route
// wrapper itself, which is tested over the wire in server/routes.test.ts.

import {randomBytes} from 'node:crypto'

import {Timestamp} from 'firebase-admin/firestore'
import {vi} from 'vitest'

import {admin_db, admin_bucket, admin_auth} from '../../server/src/firebase.ts'


// Re-exported so suites import the admin handles from one place
export {admin_db, admin_bucket, admin_auth}


// The emulator hosts the Admin SDK was pointed at (see setup_env.ts)
const FIRESTORE_HOST = process.env['FIRESTORE_EMULATOR_HOST']!
const AUTH_HOST = process.env['FIREBASE_AUTH_EMULATOR_HOST']!
const PROJECT = process.env['GCLOUD_PROJECT']!


export function new_id():string{
    // Matches the server's own url64 id generator
    return randomBytes(15).toString('base64url')
}


export async function reset_firestore():Promise<void>{
    // Drop every document in the test project (the emulator's own bulk-delete endpoint)
    const response = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}`
        + '/databases/(default)/documents', {method: 'DELETE'})
    if (!response.ok){
        throw new Error(`Failed to clear Firestore emulator: ${response.status}`)
    }
}


export async function reset_storage():Promise<void>{
    // Empty the bucket. deleteFiles with no prefix covers everything the suites write
    await admin_bucket.deleteFiles({force: true})
}


export async function reset_auth():Promise<void>{
    // Remove every emulator auth account, so a suite can't see one another suite created
    const response = await fetch(
        `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, {method: 'DELETE'})
    if (!response.ok){
        throw new Error(`Failed to clear Auth emulator: ${response.status}`)
    }
}


export async function make_anon_user():Promise<{uid:string, id_token:string}>{
    // Sign up a fresh anonymous account through the Auth emulator, returning a real ID token the
    // Admin SDK will verify — the merge handler takes one as its proof of guest ownership
    const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/`
        + 'accounts:signUp?key=fake-api-key', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({returnSecureToken: true}),
    })
    const data = await response.json() as {localId:string, idToken:string}
    return {uid: data.localId, id_token: data.idToken}
}


export async function id_token_for(uid:string):Promise<string>{
    // An ID token for an existing (or newly created) account, via a custom token exchange
    await admin_auth.getUser(uid).catch(() => admin_auth.createUser({uid}))
    const custom = await admin_auth.createCustomToken(uid)
    const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/`
        + 'accounts:signInWithCustomToken?key=fake-api-key', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token: custom, returnSecureToken: true}),
    })
    const data = await response.json() as {idToken:string}
    return data.idToken
}


export const OWNER = 'uid_owner'
export const EDITOR = 'uid_editor'
export const STRANGER = 'uid_stranger'


// Stand-in bytes for an uploaded asset — nothing here inspects them
const ASSET_BYTES = Buffer.from([1, 2, 3, 4])


export async function put_object(path:string, content_type = 'image/png'):Promise<void>{
    // Place an object in the bucket
    await admin_bucket.file(path).save(ASSET_BYTES, {contentType: content_type})
}


// Comfortably past SWEEP_GRACE_MS in assets.ts, so an object counts as old enough to judge
export const PAST_SWEEP_GRACE_MS = 11 * 60 * 1000


export async function at_later_time<T>(offset_ms:number, run:() => Promise<T>):Promise<T>{
    // Run something with the clock moved forward, so an object the emulator stamped a moment ago
    // reads as old. Only Date is faked — the Firestore and Storage clients rely on real timers,
    // and faking those would stall every request they make
    vi.useFakeTimers({toFake: ['Date'], now: Date.now() + offset_ms})
    try {
        return await run()
    } finally {
        vi.useRealTimers()
    }
}


export async function object_exists(path:string):Promise<boolean>{
    // Whether an object is still in the bucket
    return (await admin_bucket.file(path).exists())[0]
}


export async function list_paths(prefix:string):Promise<string[]>{
    // Every object path under a prefix, sorted so assertions are stable
    const [files] = await admin_bucket.getFiles({prefix})
    return files.map(file => file.name).sort()
}


export function design_doc(overrides:Record<string, unknown> = {}):Record<string, unknown>{
    // A design doc as the app writes it (see split_blueprint_doc for the blueprint fields)
    return {
        schema: 1,
        owner: OWNER,
        editor_uids: [OWNER],
        editors: {},
        share_token: 'share_token_value',
        name: 'My design',
        name_auto: 'Genesis',
        save_token: 'save_token_value',
        created: Timestamp.now(),
        modified: Timestamp.now(),
        category: null,
        latest_version: null,
        blueprint: {font_size: 10, cover: null},
        content_items: {},
        content_order: [],
        fonts: {},
        wizard_draft: null,
        simple_mode: false,
        ...overrides,
    }
}


export function version_doc(design_id:string,
        overrides:Record<string, unknown> = {}):Record<string, unknown>{
    // A frozen version doc
    return {
        schema: 1,
        design_id,
        owner: OWNER,
        created: Timestamp.now(),
        title: 'Genesis',
        status: 'available',
        pages: 120,
        error: null,
        blueprint: {font_size: 10, content: [], cover: null},
        pdf_path: 'versions/unset/doc.pdf',
        pdf_expires: Timestamp.fromMillis(Date.now() + 1000),
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


// An uploaded passage image reference, as a blueprint's content carries it
export function upload_image(path:string):Record<string, unknown>{
    return {source: 'upload', url: null, path, hash: path.slice(path.lastIndexOf('/') + 1),
        original: null}
}


// A passage content item carrying an image
export function passage_with_image(id:string, image:unknown):Record<string, unknown>{
    return {type: 'passage', id, book: 'gen', start_chapter: null, start_verse: null,
        end_chapter: null, end_verse: null, title: null, title_subtitle: '', title_icon: null,
        image}
}
