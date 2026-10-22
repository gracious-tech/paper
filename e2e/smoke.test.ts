
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
