
// A design's versions, as its own editor sees them: the list a built design opens on, and what
// each version's menu does. Versions are seeded finished (with a stand-in PDF) rather than
// compiled, since none of this depends on what's in the PDF — compile.test.ts covers the build

import {Timestamp} from 'firebase-admin/firestore'

import {test, expect, boot, click_button, design_data, owned_designs, versions_of, UI_TIMEOUT}
    from './fixtures'
import {admin_db, seed_shared_version, version_doc, new_id} from './helpers/admin'

import type {Page, Locator} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// A passage item, as a frozen blueprint or a design's content map holds it
function passage(id:string, book:string):Record<string, unknown>{
    return {type: 'passage', id, book, start_chapter: null, start_verse: null, end_chapter: null,
        end_verse: null, title: null, title_subtitle: '', title_icon: null, image: null}
}


// Seed one of the browser user's own designs with a finished latest version, plus an older one
// whose frozen content is Jude, returning all three ids
async function seed_versions(uid:string)
        :Promise<{design_id:string, latest:string, older:string}>{
    const {design_id, version_id: latest} = await seed_shared_version(uid)
    const older = new_id()
    await admin_db.doc(`versions/${older}`).set(version_doc(design_id, older, uid, {
        created: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
        save_token: 'an_older_save_token',
        blueprint: {...(await admin_db.doc(`versions/${latest}`).get()).data()!['blueprint'],
            content: [passage('jude_1', 'jud')]},
    }))
    return {design_id, latest, older}
}


// A version's row in the list: the latest is labelled as such, older ones by age
function version_row(page:Page, which:'latest'|'older'):Locator{
    const rows = page.locator('.version_list .v-list-item')
    return which === 'latest' ? rows.filter({hasText: 'Latest version'})
        : rows.filter({hasNotText: 'Latest version'})
}


// Pick an action from a version row's menu
async function version_action(page:Page, row:Locator, action:string):Promise<void>{
    await row.locator('.v-list-item__append').getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item').filter({hasText: action}).click()
}


test('a built design opens on its versions, and Edit returns to the editor', async ({page}) => {
    const uid = await boot(page)
    const {design_id} = await seed_versions(uid)

    await page.goto(`/designs/${design_id}`)
    // Nothing has changed since the latest version was built, so its list is what's shown
    const latest = version_row(page, 'latest')
    await expect(latest).toBeVisible({timeout: 60_000})
    await expect(page.getByText('Previous versions')).toBeVisible()
    await expect(latest.getByRole('button', {name: 'Edit', exact: true})).toBeVisible()

    await latest.getByRole('button', {name: 'Edit', exact: true}).click()
    await expect(page.getByLabel('Name')).toBeVisible()

    // An edit now leaves the design ahead of its latest version, which the list then flags
    await page.getByLabel('Verse numbers').uncheck()
    await expect.poll(async () => (await design_data(design_id))['save_token'])
        .not.toBe('save_token_value')
    const [newest] = await versions_of(design_id)
    await page.goto(`/designs/${design_id}/${newest!.id}`)
    await expect(version_row(page, 'latest')
        .getByRole('button', {name: 'Confirm changes', exact: true})).toBeVisible()
})


test('sharing copies the version\'s public link', async ({page, context}) => {
    // Headless Chromium offers navigator.share, which would open an OS sheet nobody can see,
    // so it's taken away to reach the clipboard path every desktop browser without it takes
    await page.addInitScript(() => {
        delete (Navigator.prototype as {share?:unknown}).share
    })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const uid = await boot(page)
    const {design_id, latest} = await seed_versions(uid)
    await page.goto(`/designs/${design_id}/${latest}`)

    await version_action(page, version_row(page, 'latest'), 'Share')
    await expect(page.getByText('Copied!')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(`${new URL(page.url()).origin}/designs/${design_id}/${latest}`)
})


test('deleting an older version', async ({page}) => {
    const uid = await boot(page)
    const {design_id, latest, older} = await seed_versions(uid)
    await page.goto(`/designs/${design_id}/${latest}`)
    await expect(version_row(page, 'older')).toHaveCount(1, {timeout: 60_000})

    await version_action(page, version_row(page, 'older'), 'Delete')

    await expect(version_row(page, 'older')).toHaveCount(0)
    await expect.poll(async () => (await versions_of(design_id)).map(version => version.id),
        {timeout: 30_000}).toEqual([latest])
    expect((await admin_db.doc(`versions/${older}`).get()).exists).toBe(false)
})


test('copying a version as a new design', async ({page}) => {
    const uid = await boot(page)
    const {design_id, latest, older} = await seed_versions(uid)
    await page.goto(`/designs/${design_id}/${latest}`)

    await version_action(page, version_row(page, 'older'), 'Copy as new design')

    // A second design of the user's own, holding the older version's content, opened at once
    await expect.poll(async () => (await owned_designs(uid)).length, {timeout: 30_000}).toBe(2)
    const copy = (await owned_designs(uid)).find(id => id !== design_id)!
    await expect(page).toHaveURL(new RegExp(`/designs/${copy}$`))
    const data = await design_data(copy)
    const items = data['content_items'] as Record<string, {book:string}>
    expect((data['content_order'] as string[]).map(id => items[id]!.book)).toEqual(['jud'])
    // The original and its versions are untouched
    expect((await versions_of(design_id)).map(version => version.id).sort())
        .toEqual([latest, older].sort())
})


test('restoring an older version into the design asks first', async ({page}) => {
    const uid = await boot(page)
    const {design_id, latest} = await seed_versions(uid)
    await page.goto(`/designs/${design_id}/${latest}`)

    await version_action(page, version_row(page, 'older'), 'Edit')
    await expect(page.getByText(/overwrite the current design's content/)).toBeVisible()
    await click_button(page.locator('.v-overlay--active .v-card').last(), 'OK')

    // The editor opens on the design, now holding what that version held
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect.poll(async () => {
        const data = await design_data(design_id)
        const items = data['content_items'] as Record<string, {book:string}>
        return (data['content_order'] as string[]).map(id => items[id]!.book)
    }, {timeout: 30_000}).toEqual(['jud'])
})


test('printing guidance for a home-printed booklet', async ({page}) => {
    const uid = await boot(page)
    const {design_id, latest} = await seed_versions(uid)
    await page.goto(`/designs/${design_id}/${latest}`)

    await page.getByRole('button', {name: 'How to print'}).click()
    const dialog = page.locator('.v-overlay--active .v-card').last()
    await expect(dialog).toBeVisible()
    // Booklets are printed double-sided and folded, so that's what the walkthrough is about
    await expect(dialog).toContainText(/fold/i)
})


test('opening a design hands its abandoned compiles to the server', async ({page}) => {
    // A browser compile that died with its tab (iOS reloads a page that runs out of memory)
    // leaves its version pending with nothing driving it, so opening the design asks the server
    const uid = await boot(page)
    const {design_id} = await seed_versions(uid)
    const minute_ago = Timestamp.fromMillis(Date.now() - 60 * 1000)
    const pending = (owner:string, overrides:Record<string, unknown> = {}) => {
        return {status: 'pending', pages: null, pdf_expires: null, compile_started: minute_ago,
            ...overrides}
    }
    const abandoned = new_id()
    const on_server = new_id()
    const not_mine = new_id()
    await admin_db.doc(`versions/${abandoned}`).set(
        version_doc(design_id, abandoned, uid, pending(uid)))
    // The server already took this one over, and a co-editor's isn't ours to compile
    await admin_db.doc(`versions/${on_server}`).set(version_doc(design_id, on_server, uid,
        pending(uid, {server_started: Timestamp.now()})))
    await admin_db.doc(`versions/${not_mine}`).set(
        version_doc(design_id, not_mine, 'a_co_editor', pending('a_co_editor')))

    // Accept every compile without running one (no journey compiles on the server)
    const requested:string[] = []
    await page.route('**/api/compile', async route => {
        requested.push((route.request().postDataJSON() as {version_id:string}).version_id)
        await route.fulfill({status: 202, contentType: 'application/json', body: '{}'})
    })

    await page.goto(`/designs/${design_id}`)
    await expect.poll(() => requested, {timeout: 60_000}).toEqual([abandoned])
    // Timed as a new attempt, so it isn't read as stuck while the server's job waits to start
    const data = (await admin_db.doc(`versions/${abandoned}`).get()).data()!
    expect((data['compile_started'] as Timestamp).toMillis()).toBeGreaterThan(minute_ago.toMillis())

    // Only once per page load, however often the design is reopened (in-app, via the navbar)
    await page.locator('.navbar .tab_btn').first().click()
    await expect(page).toHaveURL(/\/designs$/)
    await page.locator('.navbar .design_btn').filter({hasText: 'A shared document'}).click()
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}`))
    await page.waitForTimeout(2000)
    expect(requested).toEqual([abandoned])
})
