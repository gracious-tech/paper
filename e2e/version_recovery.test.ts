// Getting a version that didn't finish to finish: a failed or expired build tried again in this
// browser, an abandoned one adopted from the PDF it left behind or handed to the server, a
// browser build falling back to the server, and a cover the server finishes. Each version
// renders the compile journeys' one short passage, so a real recompile stays quick; the server
// side is stubbed at /api/compile, since no journey compiles on the server

import {Timestamp} from 'firebase-admin/firestore'

import {test, expect, boot, click_button, active_dialog, design_data, versions_of}
    from './fixtures'
import {admin_bucket, admin_db, MINIMAL_PDF, new_id, seed_own_design, version_doc}
    from './helpers/admin'

import type {Locator, Page, Route} from '@playwright/test'


// A real compile and upload, like compile.test.ts's, so they get that suite's budget
test.describe.configure({timeout: 5 * 60 * 1000})


// How long ago a timestamp was, as a Firestore Timestamp
function minutes_ago(minutes:number):Timestamp{
    return Timestamp.fromMillis(Date.now() - minutes * 60 * 1000)
}


// Seed a version of a design seeded by seed_own_design(), frozen from what the design holds
async function seed_version(uid:string, design_id:string, overrides:Record<string, unknown> = {})
        :Promise<string>{
    const design = await design_data(design_id)
    const items = design['content_items'] as Record<string, unknown>
    const id = new_id()
    await admin_db.doc(`versions/${id}`).set(version_doc(design_id, id, uid, {
        blueprint: {...design['blueprint'] as object, content: [items['passage_1']], name: ''},
        ...overrides,
    }))
    return id
}


// A finished version with its stand-in PDF in place
async function seed_finished(uid:string, design_id:string, overrides:Record<string, unknown> = {})
        :Promise<string>{
    const id = await seed_version(uid, design_id, overrides)
    await admin_bucket.file(`versions/${id}/doc.pdf`)
        .save(MINIMAL_PDF, {contentType: 'application/pdf'})
    return id
}


// The fields of a version whose compile was abandoned: still pending long past STUCK_MS, with
// the server's last attempt stamped too (so opening the design doesn't hand it over by itself,
// see resume_abandoned_versions, and only the user's Retry does)
const ABANDONED = {status: 'pending', pages: null, pdf_expires: null,
    compile_started: minutes_ago(12), server_started: minutes_ago(10)}


// One version's fields, straight from Firestore
async function version_data(id:string):Promise<Record<string, unknown>>{
    return (await admin_db.doc(`versions/${id}`).get()).data() ?? {}
}


// Whether one of a version's PDFs is in Storage
async function pdf_exists(id:string, name = 'doc'):Promise<boolean>{
    return (await admin_bucket.file(`versions/${id}/${name}.pdf`).exists())[0]
}


// Wait for the in-browser Typst engine to finish starting. A recompile from a versions page has
// no button that waits for it the way Build it does, and one started before the engine is up
// goes straight to the server instead. The module is the app's own instance (Vite serves each
// source once), so this reads the very ref the compile checks
async function until_engine_ready(page:Page):Promise<void>{
    const module_path = '/src/services/typst.ts'
    await expect.poll(() => page.evaluate(async path => {
        const typst = await import(path) as {typst_generator:{value:unknown}}
        return !!typst.typst_generator.value
    }, module_path), {timeout: 120_000}).toBe(true)
}


// Answer /api/compile with each of `answers` in turn (the last one repeating), recording the
// bodies of the requests it got
async function stub_compile(page:Page, ...answers:{status:number, error?:string}[])
        :Promise<Record<string, unknown>[]>{
    const requests:Record<string, unknown>[] = []
    await page.route('**/api/compile', async (route:Route) => {
        requests.push(route.request().postDataJSON() as Record<string, unknown>)
        const answer = answers[Math.min(requests.length, answers.length) - 1]!
        await route.fulfill({status: answer.status, contentType: 'application/json',
            body: JSON.stringify(answer.error ? {error: answer.error} : {ok: true})})
    })
    return requests
}


// The preview pane's screen for a version that has no PDF to show
function explain(page:Page):Locator{
    return page.locator('.version .explain')
}


// An older version's row in the list (the only one not labelled the latest)
function older_row(page:Page):Locator{
    return page.locator('.version_list .v-list-item').filter({hasNotText: 'Latest version'})
}


test('a failed build is tried again in this browser, from its error screen', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {
        latest_version: {status: 'failed', pages: null, save_token: 'save_token_value'}})
    const id = await seed_version(uid, design_id, {status: 'failed', pages: null,
        pdf_expires: null, error: 'Typst compilation failed', error_id: 'report_abc'})

    await page.goto(`/designs/${design_id}`)
    // The error screen gives the code to quote in a support request, report id included
    await expect(explain(page)).toContainText('An error occurred', {timeout: 60_000})
    await expect(explain(page)).toContainText(`version:${id} error:report_abc`)
    // The summary carries the same failure, for a phone that has no preview pane
    await expect(page.locator('.summary')).toContainText("This document couldn't be generated")

    await until_engine_ready(page)
    await click_button(explain(page), 'Retry')

    await expect.poll(async () => (await version_data(id))['status'],
        {timeout: 4 * 60 * 1000, intervals: [1000]}).toBe('available')
    const data = await version_data(id)
    expect(data['error']).toBe(null)
    expect(data['pages']).toBeGreaterThanOrEqual(1)
    expect(await pdf_exists(id)).toBe(true)
    await expect.poll(async () =>
        (design_data(design_id).then(design => design['latest_version'] as {status:string}))
            .then(summary => summary.status)).toBe('available')
    await expect(page.locator('.version .doc iframe')).toBeVisible({timeout: 60_000})
})


test('an expired PDF is regenerated from its version\'s row', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)
    await seed_finished(uid, design_id)
    const expired = await seed_version(uid, design_id, {created: minutes_ago(400 * 24 * 60),
        pdf_expires: minutes_ago(35 * 24 * 60), save_token: 'an_older_save_token'})

    await page.goto(`/designs/${design_id}`)
    await expect(older_row(page)).toContainText('Expired', {timeout: 60_000})

    // Its status icon explains, and offers to build it again from the settings it kept
    await until_engine_ready(page)
    await older_row(page).locator('.status button').click()
    await expect(active_dialog(page)).toContainText("This document's PDF has expired.")
    await click_button(active_dialog(page), 'Regenerate')

    await expect.poll(async () => {
        const data = await version_data(expired)
        return data['status'] === 'available'
            && (data['pdf_expires'] as Timestamp).toMillis() > Date.now()
    }, {timeout: 4 * 60 * 1000, intervals: [1000]}).toBe(true)
    expect(await pdf_exists(expired)).toBe(true)
    await expect(older_row(page)).not.toContainText('Expired')
})


test('an abandoned build whose PDF was uploaded is adopted, not compiled again', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {
        latest_version: {status: 'pending', pages: null, save_token: 'save_token_value'}})
    const id = await seed_finished(uid, design_id, ABANDONED)
    const requests = await stub_compile(page, {status: 202})

    await page.goto(`/designs/${design_id}`)
    await expect(explain(page)).toContainText('This is taking longer than expected.',
        {timeout: 60_000})

    // The engine counts the pages of the PDF that's already there
    await until_engine_ready(page)
    await click_button(explain(page), 'Retry')
    await expect.poll(async () => (await version_data(id))['status'], {timeout: 60_000})
        .toBe('available')
    expect((await version_data(id))['pages']).toBe(1)
    await expect(page.locator('.version .doc iframe')).toBeVisible({timeout: 60_000})
    expect(requests).toEqual([])
})


test('an abandoned older build is handed to the server from its row', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)
    await seed_finished(uid, design_id)
    const stuck = await seed_version(uid, design_id, {...ABANDONED,
        created: minutes_ago(15), save_token: 'an_older_save_token'})
    const requests = await stub_compile(page, {status: 202})

    await page.goto(`/designs/${design_id}`)
    await older_row(page).locator('.status button').click({timeout: 60_000})
    await expect(active_dialog(page)).toContainText('This is taking longer than expected.')
    await click_button(active_dialog(page), 'Retry')

    // Never this browser (the likeliest reason it was abandoned), and timed as a new attempt
    await expect.poll(() => requests.map(body => body['version_id'])).toEqual([stuck])
    await expect.poll(async () =>
        ((await version_data(stuck))['compile_started'] as Timestamp).toMillis())
        .toBeGreaterThan(minutes_ago(1).toMillis())
})


test.describe('when the server refuses a retry', () => {
    test.use({expected_reports: /api\/compile failed \(429 quota_exceeded\)/})

    test('the version is marked failed, with a code to quote', async ({page}) => {
        const uid = await boot(page)
        const design_id = await seed_own_design(uid, {
            latest_version: {status: 'pending', pages: null, save_token: 'save_token_value'}})
        const id = await seed_version(uid, design_id, ABANDONED)
        await stub_compile(page, {status: 429, error: 'quota_exceeded'})

        // From the summary's alert this time, which a phone shows in place of the preview pane
        await page.goto(`/designs/${design_id}`)
        const alert = page.locator('.summary .v-alert')
        await expect(alert).toContainText('This is taking longer than expected.',
            {timeout: 60_000})
        await click_button(alert, 'Retry')

        await expect.poll(async () => (await version_data(id))['status'], {timeout: 30_000})
            .toBe('failed')
        const data = await version_data(id)
        expect(data['error']).toMatch(/quota_exceeded/)
        await expect(explain(page)).toContainText(`error:${data['error_id'] as string}`)
        await expect.poll(async () =>
            ((await design_data(design_id))['latest_version'] as {status:string}).status)
            .toBe('failed')
    })
})


test.describe('a browser build that can\'t publish its PDF', () => {
    test.use({expected_reports: /storage\/unauthorized|permission/i})

    test('falls back to the server, waiting while it finishes another', async ({page}) => {
        const uid = await boot(page)
        const design_id = await seed_own_design(uid)
        // The server is busy with another of this user's compiles at first, then takes it
        const requests = await stub_compile(page, {status: 409, error: 'compile_in_progress'},
            {status: 202})
        // Storage refuses the interior's upload (as it would a second attempt's create-once
        // object), after the browser has done the whole compile
        await page.route(url => url.pathname.startsWith('/v0/b/')
                && decodeURIComponent(url.href).includes('versions/'), async (route:Route) => {
            if (route.request().method() !== 'POST'){
                await route.continue()
                return
            }
            await route.fulfill({status: 403, contentType: 'application/json',
                body: JSON.stringify({error: {code: 403, message: 'Permission denied.'}})})
        })

        await page.goto(`/designs/${design_id}`)
        const build = page.getByRole('button', {name: 'Build it', exact: true})
            .locator('visible=true').first()
        await expect(build).toBeEnabled({timeout: 120_000})
        await build.click()

        // The second ask comes after the server's 10s wait between turns
        await expect.poll(() => requests.length, {timeout: 3 * 60 * 1000}).toBe(2)
        const [version] = await versions_of(design_id)
        expect(requests.map(body => body['version_id'])).toEqual([version!.id, version!.id])
        expect(requests[0]!['page_count']).toEqual(expect.any(Number))
        // The browser's attempt is recorded once, as the compile it was: it was the upload after
        // it that failed, not the compile
        const stats = await admin_db.collection('compile_stats')
            .where('version_id', '==', version!.id).get()
        expect(stats.docs.map(doc => doc.data()['ok'])).toEqual([true])
        expect(version!.data['status']).toBe('pending')
    })
})


test('a failed cover is finished by the server on a device that builds there', async ({page}) => {
    // A device in server mode renders no cover itself, so the retry hands it over as cover-only
    await page.addInitScript(() => {
        localStorage.setItem('compile_on_server', '1')
    })
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)
    const cover = {form: {}, bg_image: null, font_families: [], title_custom: false}
    const design = await design_data(design_id)
    await admin_db.doc(`designs/${design_id}`).update(
        {blueprint: {...design['blueprint'] as object, cover}})
    const id = await seed_finished(uid, design_id, {cover_status: 'failed'})
    const requests = await stub_compile(page, {status: 202})

    await page.goto(`/designs/${design_id}`)
    const alert = page.locator('.summary .v-alert')
    await expect(alert).toContainText("The cover couldn't be generated", {timeout: 60_000})
    await click_button(alert, 'Retry')

    await expect.poll(() => requests).toEqual([{version_id: id, cover_only: true}])
    expect((await version_data(id))['cover_status']).toBe('pending')
    // Meanwhile the cover's button says it's on its way
    await expect(page.locator('.version .toolbar .mode button').last()).toBeDisabled()
})
