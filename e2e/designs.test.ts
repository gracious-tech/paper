
// The designs list (/designs): finding a design among many, and everything its per-design menu
// does — rename, duplicate, categorise, delete. Designs are seeded under the browser's own uid
// once it's known, and arrive through the app's live listener just as a co-editor's would

import {Timestamp} from 'firebase-admin/firestore'

import {test, expect, boot, design_data, owned_designs, UI_TIMEOUT} from './fixtures'
import {admin_db, admin_bucket, design_doc, new_id} from './helpers/admin'

import type {Page, Locator} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// Seed a design the browser's user owns, returning its id. `age` (minutes) orders the list
async function seed_design(uid:string, name:string, age = 0,
        overrides:Record<string, unknown> = {}):Promise<string>{
    const design_id = new_id()
    const modified = Timestamp.fromMillis(Date.now() - age * 60_000)
    await admin_db.doc(`designs/${design_id}`).set(design_doc(uid, {
        name, share_token: new_id(), modified, created: modified, ...overrides}))
    return design_id
}


// Seed `count` more designs, older than any the test names, to fill the list out to the length
// where its search box and sort toggle appear
async function seed_fillers(uid:string, count:number):Promise<void>{
    for (let i = 1; i <= count; i++){
        await seed_design(uid, `Zulu ${i}`, 1000 + i)
    }
}


// A design's row in the list
function row(page:Page, name:string):Locator{
    return page.locator('.design-item').filter({hasText: name})
}


// The names of the listed designs, in the order shown
async function listed_names(page:Page):Promise<string[]>{
    return (await page.locator('.design-item .v-list-item-title').allInnerTexts())
        .map(text => text.trim())
}


// Pick an action from a design row's menu
async function row_action(page:Page, name:string, action:string):Promise<void>{
    await row(page, name).getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item').filter({hasText: action}).click()
}


test('an empty list offers to create a first design', async ({page}) => {
    await boot(page)
    await expect(page.getByText('No designs yet')).toBeVisible()
    await page.getByRole('button', {name: 'Create your first design', exact: true}).click()
    await expect(page.getByText('What do you want it to look like?')).toBeVisible()
})


test('a short list has no search box or sort toggle', async ({page}) => {
    const uid = await boot(page)
    await seed_design(uid, 'Alpha')
    await seed_fillers(uid, 8)
    await expect(page.locator('.design-item')).toHaveCount(9)
    await expect(page.getByPlaceholder('Search designs')).toBeHidden()
    await expect(page.getByRole('button', {name: 'Name', exact: true})).toBeHidden()

    // The tenth design brings them in
    await seed_design(uid, 'Bravo')
    await expect(page.getByPlaceholder('Search designs')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Name', exact: true})).toBeVisible()
})


test('designs are listed most recent first, and can be sorted by name', async ({page}) => {
    const uid = await boot(page)
    await seed_design(uid, 'Bravo', 30)
    await seed_design(uid, 'Alpha', 10)
    await seed_design(uid, 'Charlie', 20)
    await seed_fillers(uid, 7)
    const fillers = Array.from({length: 7}, (_, i) => `Zulu ${i + 1}`)

    await expect.poll(() => listed_names(page)).toEqual(['Alpha', 'Charlie', 'Bravo', ...fillers])
    await page.getByRole('button', {name: 'Name', exact: true}).click()
    await expect.poll(() => listed_names(page)).toEqual(['Alpha', 'Bravo', 'Charlie', ...fillers])

    // The choice is remembered
    await page.reload()
    await expect.poll(() => listed_names(page), {timeout: 60_000})
        .toEqual(['Alpha', 'Bravo', 'Charlie', ...fillers])

    // The navbar keeps the three most recent close at hand
    const tabs = page.locator('.navbar .design_btn')
    await expect(tabs).toHaveText(['Alpha', 'Charlie', 'Bravo'])
})


test('search filters by name, and says so when nothing matches', async ({page}) => {
    const uid = await boot(page)
    await seed_design(uid, 'Psalms for the sick')
    await seed_design(uid, 'Gospel of John')
    await seed_fillers(uid, 8)
    await expect(page.locator('.design-item')).toHaveCount(10)

    await page.getByPlaceholder('Search designs').fill('psalm')
    await expect.poll(() => listed_names(page)).toEqual(['Psalms for the sick'])

    await page.getByPlaceholder('Search designs').fill('Leviticus')
    await expect(page.getByText('No matching designs')).toBeVisible()
    // Clearing it brings everything back
    await page.locator('.search').getByRole('button').click()
    await expect(page.locator('.design-item')).toHaveCount(10)
})


test('a guest with designs is warned they live only in this browser', async ({page}) => {
    const uid = await boot(page)
    await expect(page.getByText('No designs yet')).toBeVisible()
    await expect(page.getByText(/only saved in this browser/)).toBeHidden()

    await seed_design(uid, 'Something to lose')
    await expect(page.getByText(/only saved in this browser/)).toBeVisible()
    await page.locator('.signin_warning').getByRole('button', {name: 'Sign in', exact: true}).click()
    await expect(page.getByText('Email me a sign-in link')).toBeVisible()
})


// Make the browser offer to install the app, as Chromium does once a page meets its install
// criteria (headless Chromium never does), with a prompt() that records being called and answers
// as the user would
async function offer_install(page:Page, outcome:'accepted'|'dismissed'):Promise<void>{
    await page.evaluate(answer => {
        const event = new Event('beforeinstallprompt') as Event & {prompt:() => Promise<unknown>}
        event.prompt = () => {
            (window as unknown as {prompted:boolean}).prompted = true
            return Promise.resolve({outcome: answer})
        }
        window.dispatchEvent(event)
    }, outcome)
}


test('installing is offered only while the browser can, until turned down', async ({page}) => {
    const uid = await boot(page)
    await seed_design(uid, 'Something to come back to')
    await expect(row(page, 'Something to come back to')).toBeVisible()
    const notice = page.getByText('Install Paper Bible on this device')
    await expect(notice).toBeHidden()

    // Installing opens the browser's own dialog, and the notice goes with the offer it used
    await offer_install(page, 'accepted')
    await expect(notice).toBeVisible()
    await page.getByRole('button', {name: 'Install', exact: true}).click()
    expect(await page.evaluate(() => (window as unknown as {prompted:boolean}).prompted))
        .toBe(true)
    await expect(notice).toBeHidden()

    // Closing it turns installing down for good, offers or not
    await offer_install(page, 'accepted')
    await expect(notice).toBeVisible()
    await page.locator('.install').getByRole('button', {name: 'Close'}).click()
    await expect(notice).toBeHidden()
    await page.reload()
    await expect(row(page, 'Something to come back to')).toBeVisible({timeout: 60_000})
    await offer_install(page, 'accepted')
    await expect(notice).toBeHidden()
})


test('renaming from the list', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_design(uid, 'Old name')

    await row_action(page, 'Old name', 'Rename')
    const prompt = page.locator('.v-overlay--active .v-card')
    await expect(prompt.getByText('Rename design')).toBeVisible()
    await prompt.getByRole('textbox').fill('  New name  ')
    await prompt.getByRole('button', {name: 'OK', exact: true}).click()

    await expect(row(page, 'New name')).toBeVisible()
    // Trimmed on the way in
    await expect.poll(async () => (await design_data(design_id))['name']).toBe('New name')
})


test('duplicating copies the design and opens the copy', async ({page}) => {
    const uid = await boot(page)
    const source = await seed_design(uid, 'The original', 0, {category: 'Youth group'})

    await row_action(page, 'The original', 'Duplicate')

    // A second design of the user's own, which the app navigates to
    await expect.poll(async () => (await owned_designs(uid)).length, {timeout: 30_000}).toBe(2)
    const copy = (await owned_designs(uid)).find(id => id !== source)!
    await expect(page).toHaveURL(new RegExp(`/designs/${copy}$`))

    const data = await design_data(copy)
    expect(data['name']).toBe('The original')
    expect(data['category']).toBe('Youth group')
    // Its own invite link, so sharing the copy never shares the original
    expect(data['share_token']).not.toBe((await design_data(source))['share_token'])
    expect(data['latest_version']).toBe(null)
})


test('categories group designs, and can be renamed or removed', async ({page}) => {
    const uid = await boot(page)
    const first = await seed_design(uid, 'First')
    const second = await seed_design(uid, 'Second')
    await expect(page.locator('.design-item')).toHaveCount(2)
    // Nothing is grouped yet, and ungrouped designs get no heading of their own
    await expect(page.locator('.group-heading')).toHaveCount(0)

    // Put one in a new category
    await row_action(page, 'First', 'Category')
    const dialog = page.locator('.v-overlay--active .v-card')
    await dialog.getByRole('combobox', {name: 'Category'}).fill('Sunday school')
    await dialog.getByRole('button', {name: 'Save', exact: true}).click()
    await expect(page.locator('.group-heading')).toHaveText(['Sunday school'])
    await expect.poll(async () => (await design_data(first))['category']).toBe('Sunday school')

    // Rename it from its heading's menu
    await page.locator('.subheader').filter({hasText: 'Sunday school'})
        .getByRole('button').click()
    await page.locator('.v-overlay--active .v-list-item')
        .filter({hasText: 'Rename category'}).click()
    const prompt = page.locator('.v-overlay--active .v-card')
    await prompt.getByRole('textbox').fill('Kids')
    await prompt.getByRole('button', {name: 'OK', exact: true}).click()
    await expect(page.locator('.group-heading')).toHaveText(['Kids'])
    await expect.poll(async () => (await design_data(first))['category']).toBe('Kids')

    // And remove it, which ungroups its designs rather than deleting them
    await page.locator('.subheader').filter({hasText: 'Kids'}).getByRole('button').click()
    await page.locator('.v-overlay--active .v-list-item')
        .filter({hasText: 'Remove category'}).click()
    await page.getByRole('button', {name: 'OK', exact: true}).click()
    await expect(page.locator('.group-heading')).toHaveCount(0)
    await expect.poll(async () => (await design_data(first))['category']).toBe(null)
    expect((await owned_designs(uid)).sort()).toEqual([first, second].sort())
})


test('deleting asks first, then removes the design and its files', async ({page}) => {
    const uid = await boot(page)
    const keep = await seed_design(uid, 'Keep me')
    const doomed = await seed_design(uid, 'Delete me')
    const asset = `design_assets/${doomed}/${'a'.repeat(64)}.png`
    await admin_bucket.file(asset).save(Buffer.from('not really a png'),
        {contentType: 'image/png'})
    await expect(page.locator('.design-item')).toHaveCount(2)

    // Cancelling leaves it alone
    await row_action(page, 'Delete me', 'Delete')
    await expect(page.getByText('Delete this design? This cannot be undone.')).toBeVisible()
    await page.getByRole('button', {name: 'Cancel', exact: true}).click()
    await expect(page.locator('.design-item')).toHaveCount(2)

    await row_action(page, 'Delete me', 'Delete')
    await page.getByRole('button', {name: 'OK', exact: true}).click()
    await expect(row(page, 'Delete me')).toHaveCount(0)
    await expect.poll(() => owned_designs(uid), {timeout: 30_000}).toEqual([keep])
    // Deleting is server-side precisely so the design's uploads go with it
    expect((await admin_bucket.file(asset).exists())[0]).toBe(false)
})


test('opening a design from the list and coming back', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_design(uid, 'Open me', 0, {simple_mode: false})

    await row(page, 'Open me').click()
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}$`))
    await expect(page.getByLabel('Name')).toHaveValue('Open me')

    // The list icon at the left of the navbar is the way back
    await page.locator('.navbar .tab_btn').first().click()
    await expect(page).toHaveURL(/\/designs$/)
    await expect(row(page, 'Open me')).toBeVisible()
})
