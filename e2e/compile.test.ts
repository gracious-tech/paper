
// The one journey that exercises the render path itself: a design with real scripture in it,
// compiled to a PDF in the browser by the Typst WASM worker and uploaded to Storage.
//
// Two outside dev servers are in play, and they are not equally required. The scripture comes
// from the fetch.bible dev server, so without it there is nothing to render and these skip. The
// curated fonts come from the bookcover repo's dev server, and load_fonts() failing is caught
// and shown as a banner — Typst substitutes and the document still compiles — so that one only
// warns. Both live in other repos, so either being down is an environment problem rather than a
// failure of anything here.

import {connect} from 'node:net'

import {test, expect} from '@playwright/test'

import {admin_db, admin_bucket, browser_uid, seed_own_design, COMPILE_BIBLE, COMPILE_BOOK}
    from './helpers/admin'

import type {Page} from '@playwright/test'


// A real compile is seconds of WASM work on top of starting the worker and loading fonts, so
// this gets a budget of its own rather than the sharing journeys' two minutes
test.describe.configure({timeout: 5 * 60 * 1000})


// The dev servers this journey depends on (see CLAUDE.md's Development section for how to start
// them). ASSETS_PREFIX / the content endpoint in the app point at these same ports
const BOOKCOVER_PORT = 5301
const CONTENT_PORT = 8430


// Whether anything holds this port at this address. A raw TCP connect rather than a request,
// because an HTTP probe answers through whatever proxy the environment has configured — a dead
// port came back as a cheerful 403 here, which read as "up" and skipped nothing
async function connectable(port:number, host:string):Promise<boolean>{
    return await new Promise(resolve => {
        const socket = connect({port, host})
        const done = (result:boolean) => {
            socket.destroy()
            resolve(result)
        }
        socket.on('connect', () => done(true))
        socket.on('error', () => done(false))
        socket.setTimeout(2000, () => done(false))
    })
}


async function listening(port:number):Promise<boolean>{
    // Both loopback families, because a dev server that binds only one is still up as far as the
    // browser is concerned — it resolves 'localhost' across both. Probing 127.0.0.1 alone
    // reported a live IPv6-only server as down, and the warning that produced was simply false
    const results = await Promise.all(
        ['127.0.0.1', '::1'].map(host => connectable(port, host)))
    return results.includes(true)
}


// Whether the scripture is available at all, worked out once and applied per test — test.skip()
// is only honoured from beforeEach or a test body, never from beforeAll
let have_content = false

test.beforeAll(async () => {
    have_content = await listening(CONTENT_PORT)
    if (!have_content){
        console.warn(`\n  SKIPPING the compile journey — the fetch.bible dev server`
            + ` (localhost:${CONTENT_PORT}) isn't running, so there is no scripture to`
            + ' render.\n')
    }
    // Not fatal: load_fonts() failing is caught and shown as a banner, and Typst substitutes,
    // so the document still compiles — just not in the curated faces
    if (!await listening(BOOKCOVER_PORT)){
        console.warn(`\n  NOTE the bookcover dev server (localhost:${BOOKCOVER_PORT}) isn't`
            + ' running — this compiles with substituted fonts rather than the curated set.\n')
    }
})

test.beforeEach(() => {
    test.skip(!have_content, 'Needs the fetch.bible dev server, which this repo doesn\'t own')
})


// Boot the app as a returning visitor and return the browser's anonymous uid
async function boot(page:Page):Promise<string>{
    await page.addInitScript(() => {
        localStorage.setItem('welcome_seen', 'true')
    })
    await page.goto('/')
    await expect(page.locator('#app *').first()).toBeAttached({timeout: 60_000})
    return await browser_uid(page)
}


// A design's versions, as id + fields
async function versions_of(design_id:string)
        :Promise<{id:string, data:Record<string, unknown>}[]>{
    const snap = await admin_db.collection('versions')
        .where('design_id', '==', design_id).get()
    return snap.docs.map(item => ({id: item.id, data: item.data()}))
}


// Click Create and wait for the compile to stop being pending, whichever way it went — waiting
// for 'available' directly would time out with nothing to show when a compile fails, where this
// lets the caller assert against the version's own error
async function generate(page:Page, design_id:string):Promise<{id:string,
        data:Record<string, unknown>}>{
    // The button stays disabled until the Typst worker has loaded the compiler from the assets
    // server — the very dependency this file guards on, so a generous wait here distinguishes
    // "still loading" from "never going to load"
    const create = page.getByRole('button', {name: 'Create', exact: true})
    await expect(create).toBeEnabled({timeout: 120_000})
    await create.click()

    // Two separate waits on purpose. "Not pending" alone would pass the instant it's asked,
    // before the freeze has even written a doc — undefined is not 'pending' either
    await expect.poll(async () => (await versions_of(design_id)).length,
        {timeout: 60_000, intervals: [500]}).toBe(1)
    await expect.poll(async () => (await versions_of(design_id))[0]!.data['status'],
        {timeout: 4 * 60 * 1000, intervals: [1000]}).not.toBe('pending')
    return (await versions_of(design_id))[0]!
}


test('creating a version compiles a real PDF and uploads it', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)

    await page.goto(`/designs/${design_id}`)
    const version = await generate(page, design_id)

    // Clicking froze the design into a version of the caller's own and navigated to it
    expect(version.data['design_id']).toBe(design_id)
    expect(version.data['owner']).toBe(uid)
    await expect(page).toHaveURL(
        new RegExp(`/designs/${design_id}/${version.id}$`), {timeout: 60_000})

    expect(version.data['error'] ?? null).toBe(null)
    expect(version.data['status']).toBe('available')
    // A plausible length for one short letter, not merely "more than nothing" — a render that
    // dropped its text would still report a page, and this is a home-print booklet so the count
    // is imposed sheet sides rather than reader pages
    expect(version.data['pages']).toBeGreaterThanOrEqual(1)
    expect(version.data['pages']).toBeLessThanOrEqual(8)

    // The frozen blueprint is what was published, not what the design holds now
    const blueprint = version.data['blueprint'] as {bibles:string[], content:{book:string}[]}
    expect(blueprint.bibles).toEqual([COMPILE_BIBLE])
    expect(blueprint.content.map(item => item.book)).toEqual([COMPILE_BOOK])

    // ...and the PDF itself is in Storage, at the path the rules pin rather than any the doc
    // could have named
    const pdf_path = `versions/${version.id}/doc.pdf`
    expect(version.data['pdf_path']).toBe(pdf_path)

    const file = admin_bucket.file(pdf_path)
    expect((await file.exists())[0]).toBe(true)
    const [bytes] = await file.download()
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)

    // The design's denormalised summary follows the version it just produced, so the designs
    // list doesn't keep offering to generate what was already generated
    const design = (await admin_db.doc(`designs/${design_id}`).get()).data()!
    const summary = design['latest_version'] as {status:string, pages:number, save_token:string}
    expect(summary.status).toBe('available')
    expect(summary.pages).toBe(version.data['pages'])
    // design_needs_editor compares these by equality, so a copied token means "nothing
    // unrendered since" — the whole point of freezing it at click time
    expect(summary.save_token).toBe(design['save_token'])
    expect(version.data['save_token']).toBe(design['save_token'])
})


test('the compiled PDF is readable by version id alone', async ({page, context}) => {
    // A version id is the whole capability, so the rendered PDF must come back to a caller with
    // no claim on the design beyond knowing the id — including one who has never signed in
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)

    await page.goto(`/designs/${design_id}`)
    const version = await generate(page, design_id)
    expect(version.data['status']).toBe('available')

    // Fetched through a plain request carrying none of the app's credentials
    const url = `http://localhost:9199/v0/b/${admin_bucket.name}/o/`
        + `${encodeURIComponent(`versions/${version.id}/doc.pdf`)}?alt=media`
    const response = await context.request.get(url)
    expect(response.status()).toBe(200)
    expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
})
