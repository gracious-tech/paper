
// What every journey shares: the `test` they're written with (which fails any test whose pages
// filed an error report), booting the app, and reading back what the app wrote.
//
// Errors are reported, not shown (see "Errors are reported" in CLAUDE.md) — an uncaught
// exception or a failed background save only ever surfaces as a POST to /api/report_error. So a
// journey whose clicks all landed can still have broken something along the way, and watching
// those reports is how a test finds out. A test that provokes a failure on purpose declares the
// reports it expects with `test.use({expected_reports: /pattern/})`

import {test as base, expect} from '@playwright/test'

import {admin_db, browser_uid} from './helpers/admin'
import {COLLECTING, record_context} from '../coverage/e2e.ts'

import type {Page, Locator} from '@playwright/test'


export {expect}


// One error report, as the app posts it (see save_error in app/src/services/errors.ts)
interface ErrorReport {
    severity:string
    message:string
    url:string
    context?:Record<string, string|number>|null
}


export const test = base.extend<{expected_reports:RegExp|null, error_reports:ErrorReport[],
        browser_coverage:void}>({

    // Messages a test expects its pages to report, so they don't fail it. One pattern (join
    // several with |), since Playwright would read a list of two as a value plus fixture options
    expected_reports: [null, {option: true}],

    // Every report any page in the test's context posted, checked once the test is done.
    // The app throttles reports to one per 3s, so this sees the first of a burst, not all of it
    error_reports: [async ({context, expected_reports}, use) => {
        const reports:ErrorReport[] = []
        context.on('request', request => {
            if (request.method() === 'POST' && request.url().endsWith('/api/report_error')){
                reports.push(request.postDataJSON() as ErrorReport)
            }
        })
        await use(reports)
        const unexpected = reports.filter(report =>
            !expected_reports?.test(report.message))
        expect(unexpected, 'error reports the app filed during this test').toEqual([])
    }, {auto: true}],

    // On a coverage run, what the test's pages ran (see coverage/e2e.ts). Collected even when
    // the test fails, since the code it reached still ran
    browser_coverage: [async ({context}, use) => {
        if (!COLLECTING){
            await use()
            return
        }
        const collect = await record_context(context)
        await use()
        await collect()
    }, {auto: true}],
})


// Journeys that only make sense for a few seconds of UI get a short budget, rather than the
// config's default (which allows for a cold fetch.bible and Typst engine on the first test)
export const UI_TIMEOUT = 90_000


// Open the app at `path` and wait for it to mount, returning the browser's anonymous uid.
// Arrives as a returning visitor unless told otherwise — the welcome splash is a first-visit
// gate in front of the designs list (see DisplaySplash.vue), and only its own test wants it
export async function boot(page:Page, path = '/', {first_visit = false} = {}):Promise<string>{
    if (!first_visit){
        await page.addInitScript(() => {
            localStorage.setItem('welcome_seen', 'true')
        })
    }
    await page.goto(path)
    await expect(page.locator('#app *').first()).toBeAttached({timeout: 60_000})
    return await browser_uid(page)
}


// The topmost open dialog — Vuetify keeps closed ones mounted, and a confirmation opens on top of
// the dialog that asked for it, so "the last active overlay" is the one being shown
export function active_dialog(page:Page):Locator{
    return page.locator('.v-overlay--active .v-card').last()
}


// The app's own confirm/prompt dialogs (DialogConfirm, DialogPrompt), which open over everything
export const confirm_dialog = active_dialog


// Click a button by its exact name. getByRole's names match substrings by default, which here
// finds "OK" inside the wizard's "Books" step button
export async function click_button(scope:Page|Locator, name:string):Promise<void>{
    await scope.getByRole('button', {name, exact: true}).click()
}


// A design doc's fields, straight from Firestore
export async function design_data(design_id:string):Promise<Record<string, unknown>>{
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    return snap.data() ?? {}
}


// The ids of the designs a user owns
export async function owned_designs(uid:string):Promise<string[]>{
    const snap = await admin_db.collection('designs').where('owner', '==', uid).get()
    return snap.docs.map(doc => doc.id)
}


// The one design a user owns, once the app has written it — for journeys that create a design
// through the UI and then need its id
export async function only_design(uid:string):Promise<string>{
    await expect.poll(async () => (await owned_designs(uid)).length,
        {message: 'the user should own exactly one design', timeout: 30_000}).toBe(1)
    return (await owned_designs(uid))[0]!
}


// A design's versions, newest first, as id + fields
export async function versions_of(design_id:string)
        :Promise<{id:string, data:Record<string, unknown>}[]>{
    const snap = await admin_db.collection('versions')
        .where('design_id', '==', design_id).get()
    return snap.docs.map(doc => ({id: doc.id, data: doc.data()}))
        .sort((a, b) => (b.data['created'] as {toMillis():number}).toMillis()
            - (a.data['created'] as {toMillis():number}).toMillis())
}


// Click "Build it" and wait for the compile to stop being pending, whichever way it went —
// waiting for 'available' directly would time out with nothing to show when a compile fails,
// where this lets the caller assert against the version's own error. `count` is how many
// versions the design should have once this one's frozen
export async function build_version(page:Page, design_id:string, count = 1)
        :Promise<{id:string, data:Record<string, unknown>}>{
    // The button stays disabled until the Typst worker has loaded the compiler, so a generous
    // wait here distinguishes "still loading" from "never going to load". On mobile the editor
    // and the hidden desktop toolbar both hold one, so take whichever is showing
    const build = page.getByRole('button', {name: 'Build it', exact: true}).locator('visible=true')
        .first()
    await expect(build).toBeEnabled({timeout: 120_000})
    await build.click()

    // Two separate waits on purpose. "Not pending" alone would pass the instant it's asked,
    // before the freeze has even written a doc — undefined is not 'pending' either
    await expect.poll(async () => (await versions_of(design_id)).length,
        {timeout: 60_000, intervals: [500]}).toBe(count)
    await expect.poll(async () => (await versions_of(design_id))[0]!.data['status'],
        {timeout: 4 * 60 * 1000, intervals: [1000]}).not.toBe('pending')
    return (await versions_of(design_id))[0]!
}


// Wait for a debounced design write to reach Firestore. The app batches field edits before
// writing them (see designs.ts), so a check made straight after a click would race it
export async function until_saved<T>(read:() => Promise<T>, expected:T):Promise<void>{
    await expect.poll(read, {timeout: 30_000}).toEqual(expected)
}
