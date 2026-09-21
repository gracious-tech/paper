
// Admin-SDK access to the dev emulators, for seeding the state a journey starts from.
//
// The journeys below are about what someone *else* has shared with you — an invite link, a
// published version — and the browser can only ever be one user. So the other side is written
// directly here, which is also how the app's own server does it.

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'

import {initializeApp} from 'firebase-admin/app'
import {getFirestore, Timestamp} from 'firebase-admin/firestore'
import {getStorage} from 'firebase-admin/storage'

import type {Page} from '@playwright/test'


// The dev stack's emulator ports, read from firebase.json so they can't drift from it
const firebase_json = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../firebase.json', import.meta.url)), 'utf8')) as
    {emulators:{auth:{port:number}, firestore:{port:number}, storage:{port:number}}}

const PROJECT = 'paper-bible'

process.env['GCLOUD_PROJECT'] = PROJECT
process.env['FIREBASE_AUTH_EMULATOR_HOST'] =
    `127.0.0.1:${firebase_json.emulators.auth.port}`
process.env['FIRESTORE_EMULATOR_HOST'] =
    `127.0.0.1:${firebase_json.emulators.firestore.port}`
process.env['FIREBASE_STORAGE_EMULATOR_HOST'] =
    `127.0.0.1:${firebase_json.emulators.storage.port}`


const app = initializeApp({
    projectId: PROJECT,
    storageBucket: `${PROJECT}.firebasestorage.app`,
})

export const admin_db = getFirestore(app)
export const admin_bucket = getStorage(app).bucket()


export function new_id():string{
    // Matches the app's own url64 id generator
    return randomBytes(15).toString('base64url')
}


export async function browser_uid(page:Page):Promise<string>{
    // The uid of the anonymous user the app signed the browser in as.
    //
    // Read out of Firebase Auth's own IndexedDB store rather than inferred from what appeared in
    // Firestore — each test gets a fresh browser context and so a fresh account, and guessing
    // from recent writes would pick up another test's user as easily as this one's
    for (let attempt = 0; attempt < 60; attempt++){
        const uid = await page.evaluate(() => new Promise<string|null>(resolve => {
            const request = indexedDB.open('firebaseLocalStorageDb')
            request.onerror = () => resolve(null)
            request.onsuccess = () => {
                let store
                try {
                    store = request.result
                        .transaction('firebaseLocalStorage', 'readonly')
                        .objectStore('firebaseLocalStorage')
                } catch {
                    resolve(null)
                    return
                }
                const all = store.getAll()
                all.onerror = () => resolve(null)
                all.onsuccess = () => {
                    const entry = (all.result as {value?:{uid?:string}}[])
                        .find(item => item?.value?.uid)
                    resolve(entry?.value?.uid ?? null)
                }
            }
        }))
        if (uid){
            return uid
        }
        await page.waitForTimeout(250)
    }
    throw new Error('Browser never signed in')
}


// A complete set of blueprint options, as clean_blueprint() would have produced before the
// design was ever written. Realistic on purpose: the versions list renders a version's frozen
// blueprint directly (paper size, binding, translations), so a half-filled one doesn't fail the
// assertion — it takes the component down before the buttons under test ever render.
// Mirrors get_default_blueprint() in app/src/services/blueprints.ts, minus content and name
function blueprint_options():Record<string, unknown>{
    return {
        cover: null,
        service_id: 'home',
        size_id: 'a4',
        binding_type: 'paperback',
        ink_type: 'bw',
        paper_type: 'white',
        custom_unit: 'mm',
        custom_trim_width: 152,
        custom_trim_height: 229,
        custom_bleed: 3,
        custom_spine: 10,
        booklet: true,
        booklet_portrait: false,
        last_item_at_end: false,
        bibles: ['eng_bsb'],
        bibles_layout: 'columns',
        bibles_align: 'paragraph',
        show_headings: true,
        show_headings_bold: true,
        show_headings_italic: false,
        show_headings_size: 0.9,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        running_pages: true,
        running_headings: true,
        running_position: 'header',
        running_align: 'outer',
        show_footnotes: true,
        show_wj: false,
        show_wj_color: '#cc0000',
        show_wj_bold: false,
        show_wj_italic: false,
        show_lines: true,
        notes: null,
        half_blank: null,
        passage_title: 'heading',
        font_text: 'Source Serif 4',
        font_text2: null,
        font_headings: null,
        font_size: 10,
        font_size2: 1,
        footnote_size: 0.85,
        line_height: 1.35,
        line_height2: 1,
        justify: null,
        hyphenate: true,
        poetry_outdent: true,
        text_color: null,
        columns: null,
        story_emphasis: true,
        story_emphasis_color: '#4862ad',
        story_layout: 'single',
        story_alternate: false,
        titlepage_frame: 'subtle',
        titlepage_color_text: null,
        titlepage_color_icon: null,
        titlepage_color_frame: null,
        titlepage_font: null,
        titlepage_text_size: 1,
        titlepage_icon_size: 1,
        titlepage_always: 'right',
        image_style: 'padded',
        margin_unit: 'mm',
        margin_top: 20,
        margin_bottom: 20,
        margin_inner: 15,
        margin_outer: 15,
        margin_gutter_auto: true,
        column_gap: 6,
        public_domain: true,
        app_link: true,
        design_link: true,
    }
}


// A design doc as the app writes it — see split_blueprint_doc for the blueprint fields
export function design_doc(owner:string,
        overrides:Record<string, unknown> = {}):Record<string, unknown>{
    return {
        schema: 1,
        owner,
        editor_uids: [owner],
        editors: {},
        share_token: 'invite_token_value',
        name: 'A shared document',
        name_auto: 'Genesis',
        save_token: 'save_token_value',
        created: Timestamp.now(),
        modified: Timestamp.now(),
        category: null,
        latest_version: null,
        blueprint: blueprint_options(),
        content_items: {},
        content_order: [],
        fonts: {},
        wizard_draft: null,
        simple_mode: false,
        ...overrides,
    }
}


// A finished version doc
export function version_doc(design_id:string, version_id:string, owner:string,
        overrides:Record<string, unknown> = {}):Record<string, unknown>{
    return {
        schema: 1,
        design_id,
        owner,
        created: Timestamp.now(),
        title: 'A shared document',
        status: 'available',
        pages: 24,
        error: null,
        blueprint: {...blueprint_options(), content: [], name: ''},
        pdf_path: `versions/${version_id}/doc.pdf`,
        pdf_expires: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
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


// The translation and book the compile journey renders. Philemon is one chapter, which keeps a
// real end-to-end compile down to a few seconds, and eng_bsb is in the dev content server's
// manifest — see e2e/compile.test.ts for the check that the server is actually up
export const COMPILE_BIBLE = 'eng_bsb'
export const COMPILE_BOOK = 'phm'


export async function seed_own_design(uid:string,
        overrides:Record<string, unknown> = {}):Promise<string>{
    // A design the browser's own user already owns, holding one short whole-book passage.
    //
    // Seeded rather than built through the new-design wizard on purpose: this journey is about
    // the compile, and driving five wizard steps to reach it would make a Typst failure look
    // like a broken dropdown. The wizard is its own flow and deserves its own test
    const design_id = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc(uid, {
        name: 'Compile journey',
        blueprint: {...blueprint_options(), bibles: [COMPILE_BIBLE]},
        content_items: {
            passage_1: {
                type: 'passage',
                id: 'passage_1',
                book: COMPILE_BOOK,
                // All four null is the "whole book" convention (see is_whole_book)
                start_chapter: null,
                start_verse: null,
                end_chapter: null,
                end_verse: null,
                title: null,
                title_subtitle: '',
                title_icon: null,
                image: null,
            },
        },
        content_order: ['passage_1'],
        ...overrides,
    }))
    return design_id
}


// The smallest thing a browser will accept as a PDF, so the viewer has something to load
const MINIMAL_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n'
    + 'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')


export async function seed_shared_version(owner:string):Promise<{design_id:string,
        version_id:string, share_token:string}>{
    // A design owned by someone else, with one finished version and its rendered PDF in place
    const design_id = new_id()
    const version_id = new_id()
    const share_token = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc(owner, {
        share_token,
        latest_version: {status: 'available', pages: 24, save_token: 'save_token_value'},
    }))
    await admin_db.doc(`versions/${version_id}`).set(
        version_doc(design_id, version_id, owner))
    await admin_bucket.file(`versions/${version_id}/doc.pdf`)
        .save(MINIMAL_PDF, {contentType: 'application/pdf'})
    return {design_id, version_id, share_token}
}
