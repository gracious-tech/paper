
// Accounts: a guest signing in by email link or Google (and keeping their work), signing out,
// deleting everything, and the things only a signed-in owner can do — inviting editors. The auth
// emulator never sends mail, it keeps every link it "sent" for this file to read back, and it
// stands in for Google with a popup of its own that makes up whichever account it's asked for

import {test, expect, boot, active_dialog, click_button, design_data, owned_designs, UI_TIMEOUT}
    from './fixtures'
import {admin_auth, admin_db, browser_uid, design_doc, new_id} from './helpers/admin'
import {APP_URL, EMULATOR_PORTS, PROJECT} from './stack'

import type {Page} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// A fresh address per test, so no test signs in to another's account
function new_email():string{
    return `e2e_${new_id().toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`
}


// Seed a design the given user owns, returning its id
async function seed_design(uid:string, name:string):Promise<string>{
    const design_id = new_id()
    await admin_db.doc(`designs/${design_id}`).set(design_doc(uid, {name,
        share_token: new_id()}))
    return design_id
}


// A design's row in the designs list
function listed(page:Page, name:string){
    return page.locator('.design-item').filter({hasText: name})
}


// Request a sign-in link from the account dialog, as the user would
async function request_link(page:Page, email:string):Promise<void>{
    await page.locator('header .account').click()
    const dialog = active_dialog(page)
    await dialog.getByLabel('Email address').fill(email)
    await click_button(dialog, 'Email me a sign-in link')
    await expect(dialog.getByText(/we've sent you a sign-in link/)).toBeVisible()
    await click_button(dialog, 'Close')
}


// The sign-in link the emulator "emailed" to an address, as the app's own URL. The emulator's
// own link points at its action handler; the app only needs the code it carries, on its origin
async function sent_link(email:string):Promise<string>{
    const response = await fetch(`http://127.0.0.1:${EMULATOR_PORTS.auth}`
        + `/emulator/v1/projects/${PROJECT}/oobCodes`)
    const {oobCodes} = await response.json() as {oobCodes:{email:string, oobCode:string,
        oobLink:string, requestType:string}[]}
    const sent = oobCodes.filter(code => code.email === email
        && code.requestType === 'EMAIL_SIGNIN').at(-1)
    if (!sent){
        throw new Error(`No sign-in link was sent to ${email}`)
    }
    const api_key = new URL(sent.oobLink).searchParams.get('apiKey')!
    return `${APP_URL}/?mode=signIn&lang=en&oobCode=${sent.oobCode}&apiKey=${api_key}`
}


// Open a sign-in link and wait for the app to come back up signed in
async function open_link(page:Page, email:string):Promise<string>{
    await page.goto(await sent_link(email))
    await expect(page.locator('#app *').first()).toBeAttached({timeout: 60_000})
    await expect(page.locator('header .account')).not.toHaveClass(/guest/)
    // The single-use code is stripped from the address, so a refresh can't retry a spent one
    await expect(page).toHaveURL(/\/designs$/)
    return await browser_uid(page)
}


test('a guest signs in by email link and keeps their designs', async ({page}) => {
    const guest = await boot(page)
    const design_id = await seed_design(guest, 'Made as a guest')
    await expect(listed(page, 'Made as a guest')).toBeVisible()

    const email = new_email()
    await request_link(page, email)
    const uid = await open_link(page, email)

    // A real account now, with the guest's work moved into it
    expect((await admin_auth.getUser(uid)).email).toBe(email)
    await expect(listed(page, 'Made as a guest')).toBeVisible()
    await expect.poll(() => owned_designs(uid), {timeout: 30_000}).toEqual([design_id])
    await expect(page.getByText(/only saved in this browser/)).toBeHidden()

    // And the account dialog says who they are
    await page.locator('header .account').click()
    await expect(active_dialog(page).getByText(email)).toBeVisible()
})


// Start signing in with Google from the account dialog, returning the emulator's popup
async function open_google(page:Page):Promise<Page>{
    await page.locator('header .account').click()
    const popup = page.waitForEvent('popup')
    await click_button(active_dialog(page), 'Sign in with Google')
    return await popup
}


test('a sign-in link that\'s spent or expired says so', async ({page}) => {
    // Requested in this browser (so the address is known), but its code no longer valid by the
    // time it's opened, as when it was used already or sat in the inbox too long
    const guest = await boot(page)
    const email = new_email()
    await request_link(page, email)
    const link = (await sent_link(email)).replace(/oobCode=[^&]+/, 'oobCode=no_longer_valid')
    await page.goto(link)
    await expect(page.locator('#app *').first()).toBeAttached({timeout: 60_000})

    // The user is told rather than left wondering, and is still the same guest
    await expect(page.getByText('That sign-in link has already been used or has expired.'))
        .toBeVisible()
    expect(await browser_uid(page)).toBe(guest)
    await expect(page.locator('header .account.guest')).toBeVisible()
})


test('a guest signs in with Google and keeps their designs', async ({page}) => {
    const guest = await boot(page)
    await seed_design(guest, 'Made as a guest')
    await expect(listed(page, 'Made as a guest')).toBeVisible()

    // A Google account the emulator makes up there and then
    const email = new_email()
    const popup = await open_google(page)
    // Its script comes from a CDN, and a click before that has loaded does nothing
    await popup.waitForLoadState('load')
    await expect(async () => {
        await popup.getByRole('button', {name: 'Add new account'}).click()
        await expect(popup.locator('#email-input')).toBeVisible({timeout: 2000})
    }).toPass({timeout: 60_000})
    await popup.locator('#email-input').fill(email)
    await popup.locator('#display-name-input').fill('Google User')
    await popup.locator('#sign-in').click()

    // Linked in place: the same account, now with Google on it, and the dialog done with
    await expect(page.locator('header .account')).not.toHaveClass(/guest/, {timeout: 30_000})
    await expect(active_dialog(page)).toBeHidden()
    const user = await admin_auth.getUser(guest)
    expect(user.providerData.map(provider => [provider.providerId, provider.email]))
        .toEqual([['google.com', email]])
    await expect(listed(page, 'Made as a guest')).toBeVisible()
})


test('a Google account that already has an account takes the guest\'s designs into it',
    async ({page}) => {
        // Someone who signed in with Google before, on another device
        const email = new_email()
        const existing = new_id()
        await admin_auth.importUsers([{uid: existing, email, displayName: 'Returning User',
            providerData: [{uid: `google_${existing}`, email, displayName: 'Returning User',
                providerId: 'google.com'}]}])
        await seed_design(existing, 'Made on the other device')

        const guest = await boot(page)
        const design_id = await seed_design(guest, 'Made as a guest')
        await expect(listed(page, 'Made as a guest')).toBeVisible()

        // Picking that account can't link it to the guest, so the guest is merged into it
        const popup = await open_google(page)
        await popup.waitForLoadState('load')
        await popup.getByText(email).click()
        await expect.poll(() => browser_uid(page), {timeout: 30_000}).toBe(existing)
        await expect.poll(() => owned_designs(existing), {timeout: 30_000})
            .toContain(design_id)
        await expect(listed(page, 'Made as a guest')).toBeVisible()
        await expect(listed(page, 'Made on the other device')).toBeVisible()
        await expect(active_dialog(page)).toBeHidden()
    })


test('closing the Google window leaves the dialog for another try', async ({page}) => {
    await boot(page)
    const popup = await open_google(page)
    await popup.close()
    // Nothing reported or shown: dismissing it is the user's choice, and they can try again
    const google = active_dialog(page).getByRole('button', {name: 'Sign in with Google'})
    await expect(google).toBeEnabled()
    const again = page.waitForEvent('popup')
    await google.click()
    await (await again).close()
    await expect(google).toBeEnabled()
    await expect(page.locator('header .account')).toHaveClass(/guest/)
})


test('signing out starts a fresh guest, and signing back in restores the account',
    async ({page}) => {
        await boot(page)
        const email = new_email()
        await request_link(page, email)
        const uid = await open_link(page, email)
        await seed_design(uid, 'Belongs to the account')
        await expect(listed(page, 'Belongs to the account')).toBeVisible()

        await page.locator('header .account').click()
        await click_button(active_dialog(page), 'Sign out')
        await expect(page.locator('header .account')).toHaveClass(/guest/)
        await expect(page.getByText('No designs yet')).toBeVisible()
        expect(await browser_uid(page)).not.toBe(uid)

        // Back in, from the guest this browser became
        await request_link(page, email)
        expect(await open_link(page, email)).toBe(uid)
        await expect(listed(page, 'Belongs to the account')).toBeVisible()
    })


test('a link opened in another browser asks which address it was sent to',
    async ({page, browser}) => {
        await boot(page)
        const email = new_email()
        await request_link(page, email)

        // A browser that never asked for the link has no record of the address
        const other = await browser.newPage()
        await boot(other)
        await other.goto(await sent_link(email))
        const prompt = active_dialog(other)
        await expect(prompt.getByText(/confirm the email address/)).toBeVisible({timeout: 60_000})
        await prompt.getByRole('textbox').fill(email)
        await click_button(prompt, 'OK')
        await expect(other.locator('header .account')).not.toHaveClass(/guest/,
            {timeout: 60_000})
        expect((await admin_auth.getUser(await browser_uid(other))).email).toBe(email)
        await other.close()
    })


test('deleting a guest\'s data needs the word typed out', async ({page}) => {
    const guest = await boot(page)
    const design_id = await seed_design(guest, 'Short lived')
    await expect(listed(page, 'Short lived')).toBeVisible()

    await page.locator('header .account').click()
    await click_button(active_dialog(page), 'Delete data')
    const prompt = active_dialog(page)
    const confirm = prompt.getByRole('button', {name: 'Delete data', exact: true})
    // Anything but the word leaves the button disabled (case aside, so autocapitalise can't
    // refuse a correct answer)
    await expect(confirm).toBeDisabled()
    await prompt.getByRole('textbox').fill('DELET')
    await expect(confirm).toBeDisabled()
    await prompt.getByRole('textbox').fill('delete ')
    await confirm.click()

    // Everything's gone, the old account included, and the browser carries on as a new guest
    await expect(page.getByText('No designs yet')).toBeVisible({timeout: 30_000})
    await expect.poll(async () => (await design_data(design_id))['owner'] ?? null,
        {timeout: 30_000}).toBe(null)
    // The Auth user goes last (see handle_delete_account), and the list empties as soon as the
    // client releases its listeners, before the call has even returned — so wait for it
    await expect.poll(async () => await admin_auth.getUser(guest).then(() => 'exists',
        () => 'gone'), {timeout: 30_000}).toBe('gone')
    await expect.poll(async () => await browser_uid(page), {timeout: 30_000}).not.toBe(guest)
})


test('guests are asked to sign in before inviting editors', async ({page}) => {
    const guest = await boot(page)
    await seed_design(guest, 'Not shareable yet')

    await page.locator('.design-item').filter({hasText: 'Not shareable yet'})
        .getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item')
        .filter({hasText: 'Invite an editor'}).click()
    // A design shared from a guest account would be lost with the session
    await expect(page.getByText(/must first sign in to be able to invite/)).toBeVisible()

    // ...which the dialog takes them straight to
    await click_button(active_dialog(page), 'Sign in')
    await expect(active_dialog(page).getByLabel('Email address')).toBeVisible()
})


test.describe('an owner\'s invite dialog when the access list can\'t be loaded', () => {
    test.use({expected_reports: /api\/design_editors failed \(500/})

    test('still mints a link for a design without one, ready to copy', async ({page,
            context}) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await boot(page)
        const email = new_email()
        await request_link(page, email)
        const uid = await open_link(page, email)
        const design_id = await seed_design(uid, 'Never shared')
        await admin_db.doc(`designs/${design_id}`).update({share_token: null})
        await page.route('**/api/design_editors', route => route.fulfill({status: 500,
            contentType: 'application/json', body: JSON.stringify({error: 'internal'})}))

        await listed(page, 'Never shared').getByRole('button').last().click()
        await page.locator('.v-overlay--active .v-list-item')
            .filter({hasText: 'Invite an editor'}).click()
        const dialog = active_dialog(page)

        // Sharing is always on, so opening the dialog gives the design its link
        await expect.poll(async () => (await design_data(design_id))['share_token'],
            {timeout: 30_000}).not.toBe(null)
        const token = (await design_data(design_id))['share_token'] as string
        const link = `${APP_URL}/designs/${design_id}/invite/${token}`
        await expect(dialog.locator('input[readonly]')).toHaveValue(link)
        // Who has access couldn't be worked out, which it says rather than listing nobody
        await expect(page.getByText('Couldn\'t load who has access')).toBeVisible()

        await click_button(dialog, 'Copy')
        await expect(dialog.getByRole('button', {name: 'Copied!', exact: true})).toBeVisible()
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)

        await click_button(dialog, 'Close')
        await expect(dialog).toBeHidden()
    })
})


test('an owner\'s invite link, its reset, and removing an editor', async ({page}) => {
    await boot(page)
    const email = new_email()
    await request_link(page, email)
    const uid = await open_link(page, email)

    // A design already shared with one other editor
    const editor = await admin_auth.createUser({email: new_email(), displayName: 'Co Editor'})
    const design_id = await seed_design(uid, 'Shared work')
    await admin_db.doc(`designs/${design_id}`).update({
        editor_uids: [uid, editor.uid],
        [`editors.${editor.uid}`]: {joined: new Date()},
    })

    await page.locator('.design-item').filter({hasText: 'Shared work'})
        .getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item')
        .filter({hasText: 'Invite an editor'}).click()
    const dialog = active_dialog(page)

    // The link carries the design's current invite token
    const token = (await design_data(design_id))['share_token'] as string
    const link = dialog.locator('input[readonly]')
    await expect(link).toHaveValue(`${APP_URL}/designs/${design_id}/invite/${token}`)

    // Resetting it retires that token for a new one
    await click_button(dialog, 'Reset link')
    await expect.poll(async () => (await design_data(design_id))['share_token'])
        .not.toBe(token)
    await expect(link).not.toHaveValue(new RegExp(token))

    // Both people are listed (resolved server-side), and the editor can be removed
    const editor_row = dialog.locator('.v-list-item').filter({hasText: 'Co Editor'})
    await expect(dialog.locator('.v-list-item').filter({hasText: 'Owner'})).toBeVisible()
    await expect(editor_row).toBeVisible()
    await editor_row.getByRole('button').click()
    await expect(editor_row).toBeHidden()
    await expect.poll(async () => (await design_data(design_id))['editor_uids'],
        {timeout: 30_000}).toEqual([uid])
})
