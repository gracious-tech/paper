
// The app shell: that it boots at all, who gets greeted by the welcome splash, and the pages
// and routes around the designs themselves. init.ts only mounts #app once anonymous auth, the
// content collection and the UI catalog resolve, so booting is itself a check that the stack —
// emulators, fetch.bible, the app — is up and talking

import {test, expect, boot, UI_TIMEOUT} from './fixtures'
import {admin_auth} from './helpers/admin'


test.describe.configure({timeout: UI_TIMEOUT})


test('the app boots, signed in as a guest', async ({page}) => {
    const errors:string[] = []
    page.on('pageerror', error => {
        errors.push(String(error))
    })
    const uid = await boot(page)

    // Every visitor is a real (anonymous) account from the start
    const user = await admin_auth.getUser(uid)
    expect(user.providerData).toEqual([])
    // And the header flags it, inviting them to sign in
    await expect(page.locator('header .account.guest')).toBeVisible()
    expect(errors).toEqual([])
})


test.describe('a bundle that never starts', () => {

    // public/boot_check.js reports these itself, since errors.ts never ran
    test.use({expected_reports: /^Boot check: /})

    // The app's entry module, as index.pug asks the dev server for it
    const ENTRY = /\/src\/init\.ts(\?|$)/

    test('says the browser is too old when it can\'t parse the bundle', async ({page}) => {
        // Chromium reports a module's SyntaxError to window.onerror, as regex lookbehind did on
        // iOS 15 (which Chromium itself parses, so the syntax error here is a stand-in)
        await page.route(ENTRY, route => route.fulfill(
            {contentType: 'application/javascript', body: 'let let = 1'}))
        const report = page.waitForRequest(/\/api\/report_error$/)
        await page.goto('/')
        await expect(page.getByText('Sorry, your browser is too old')).toBeVisible()
        expect((await report).postDataJSON().message).toMatch(/^Boot check: SyntaxError/)
    })

    test('offers a reload when the bundle fails without a SyntaxError', async ({page}) => {
        // A failed fetch only fires the <script> element's own error event, which may also be
        // all Safari gives for a parse error, so this is the path that has to catch it there
        await page.route(ENTRY, route => route.abort())
        const report = page.waitForRequest(/\/api\/report_error$/)
        await page.goto('/')
        await expect(page.getByText('Sorry, Paper Bible couldn\'t start')).toBeVisible()
        await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeVisible()
        expect((await report).postDataJSON().message)
            .toMatch(/^Boot check: the bundle never started \(failed: .*\/src\/init\.ts/)
    })
})


test('a first visit is welcomed, once', async ({page}) => {
    await boot(page, '/', {first_visit: true})

    await expect(page.getByText('Print Scripture in whatever style you need')).toBeVisible()
    await page.getByRole('button', {name: 'Start Creating', exact: true}).click()
    await expect(page.getByText('No designs yet')).toBeVisible()

    // Remembered, so it isn't shown again on the next visit
    await page.reload()
    await expect(page.getByText('No designs yet')).toBeVisible({timeout: 60_000})
    await expect(page.getByText('Print Scripture in whatever style you need')).toBeHidden()
})


test('a page someone was linked to is shown without the splash', async ({page}) => {
    // The splash greets the designs list only, so a linked page reads first
    await boot(page, '/about', {first_visit: true})
    await expect(page.getByText(/Paper Bible is a free app/)).toBeVisible()
    await expect(page.getByText('Print Scripture in whatever style you need')).toBeHidden()

    // ...and the visitor is welcomed if they go on to the list
    await page.getByRole('link', {name: 'Paper Bible'}).click()
    await expect(page.getByText('Print Scripture in whatever style you need')).toBeVisible()
})


test('the about, privacy and publishers pages', async ({page}) => {
    await boot(page)

    // About is reached from the header's menu
    await page.locator('header h1').getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item').filter({hasText: 'About'}).click()
    await expect(page).toHaveURL(/\/about$/)
    await expect(page.getByText(/Paper Bible is a free app/)).toBeVisible()
    // These pages are linked to from outside, so they hide the designs navbar
    await expect(page.locator('.navbar')).toBeHidden()
    await expect(page.getByText(/^Version: dev$/)).toBeVisible()

    // About links on to the privacy policy and the publishers' replies
    await page.getByRole('link', {name: 'Privacy policy'}).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByText(/We take your privacy seriously/)).toBeVisible()

    await page.goto('/publishers')
    await expect(page.getByText('Replies from publishers')).toBeVisible({timeout: 60_000})
    await page.getByRole('link', {name: 'About'}).click()
    await expect(page).toHaveURL(/\/about$/)

    // And Home goes back to the designs list
    await page.getByRole('link', {name: 'Home'}).click()
    await expect(page).toHaveURL(/\/designs$/)
    await expect(page.locator('.navbar')).toBeVisible()
})


test('unknown addresses land on the designs list', async ({page}) => {
    await boot(page, '/no/such/page')
    await expect(page).toHaveURL(/\/designs$/)
    await expect(page.getByText('No designs yet')).toBeVisible()
})


test('a design that doesn\'t exist explains itself', async ({page}) => {
    // An unbuilt or missing design looks the same from outside (the rules hide the doc), so
    // the app says why the link went nowhere rather than silently showing the list
    await boot(page, '/designs/not_a_real_design_id')
    await expect(page.getByText(/hasn't been built into a document yet/)).toBeVisible()
    await page.getByRole('button', {name: 'Dismiss', exact: true}).click()
    await expect(page).toHaveURL(/\/designs$/)
})
