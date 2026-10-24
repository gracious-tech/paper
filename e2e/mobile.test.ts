
// The phone layout, below AppRoot's 900px breakpoint, run by the config's `mobile` project.
// AppRoot mounts no preview pane there at all, so whatever the pane does on desktop has to
// happen some other way: the editor previews on request, full screen, before building (which
// also measures the page-count estimate the build freezes), the downloads move into the
// versions list, and the example designs and intro video sit inline. A phone that can't cope
// compiles nothing itself, and has the server make its previews and builds instead (see
// compile_mode.ts)

import {test, expect, boot, build_version, click_button, owned_designs, versions_of, UI_TIMEOUT}
    from './fixtures'
import {seed_own_design, stub_server_preview} from './helpers/admin'


test.describe.configure({timeout: UI_TIMEOUT})


test('there is no preview pane', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)

    await expect(page.getByLabel('Name')).toBeVisible({timeout: 60_000})
    // Not mounted rather than hidden, so nothing compiles previews nobody can see
    await expect(page.locator('.display')).toHaveCount(0)
    // The editor previews first rather than building straight away
    await expect(page.getByRole('button', {name: 'Preview', exact: true})
        .locator('visible=true')).toHaveCount(1)
    await expect(page.getByRole('button', {name: 'Build it', exact: true})
        .locator('visible=true')).toHaveCount(0)
})


test('building from the simple editor, then opening the PDF', async ({page}) => {
    // A real compile, like compile.test.ts's, so it gets that suite's budget
    test.setTimeout(5 * 60 * 1000)
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: true})
    await page.goto(`/designs/${design_id}`)

    // The preview shows the pages as images, and Build it in its top bar builds what it shows.
    // Simple mode derives the binding from the page estimate, which the preview measures — a
    // build without one would freeze a guess
    const preview = page.getByRole('button', {name: 'Preview', exact: true})
        .locator('visible=true')
    await expect(preview).toBeEnabled({timeout: 120_000})
    await preview.click()
    const pages = page.locator('.preview img.page')
    await expect(pages.first()).toBeVisible({timeout: 60_000})
    expect(await pages.first().evaluate(img => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
    const version = await build_version(page, design_id)
    expect(version.data['error'] ?? null).toBe(null)
    expect(version.data['status']).toBe('available')
    expect(version.data['pages']).toBeGreaterThanOrEqual(1)

    // The PDFs the desktop shows in the preview toolbar are in the versions list instead, and
    // open in a new tab since there's no preview pane to view them in
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}/${version.id}$`))
    // (headless Chromium has no PDF viewer, so the tab's navigation aborts into a download —
    // the navigation request itself is what shows the tab was pointed at the PDF)
    const opening = page.context().waitForEvent('page')
    const navigating = page.context().waitForEvent('request',
        request => request.isNavigationRequest() && request.url().includes('doc.pdf'))
    await click_button(page.locator('.mobile_actions'), 'Open interior')
    const tab = await opening
    expect((await navigating).frame().page()).toBe(tab)
})


test('Keep editing closes the preview, back to the editor', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: true})
    await page.goto(`/designs/${design_id}`)
    const preview = page.getByRole('button', {name: 'Preview', exact: true})
        .locator('visible=true')
    await expect(preview).toBeEnabled({timeout: 120_000})
    await preview.click()
    await expect(page.locator('.preview img.page').first()).toBeVisible({timeout: 60_000})
    await click_button(page, 'Keep editing')
    await expect(page.locator('.preview img.page')).toHaveCount(0)
    await expect(preview).toBeVisible()
})


test('a phone switched to the server previews and builds there', async ({page}) => {
    await page.addInitScript(() => {
        localStorage.setItem('compile_on_server', '1')
    })
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: true})

    // Accept the preview and the compile without running either (no journey compiles on the
    // server): the preview settled at once, the compile left pending
    const previews = await stub_server_preview(page, uid)
    const requested:string[] = []
    await page.route('**/api/compile', async route => {
        requested.push((route.request().postDataJSON() as {version_id:string}).version_id)
        await route.fulfill({status: 202, contentType: 'application/json', body: '{}'})
    })
    await page.goto(`/designs/${design_id}`)

    // The server's pages, shown like the browser's
    const preview = page.getByRole('button', {name: 'Preview', exact: true})
        .locator('visible=true')
    await expect(preview).toBeEnabled({timeout: 120_000})
    await preview.click()
    const pages = page.locator('.preview img.page')
    await expect(pages).toHaveCount(1, {timeout: 60_000})
    await expect.poll(() => pages.first().evaluate(img => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
    expect(previews).toEqual(['phone'])

    // Build it, handed to the server as soon as the version exists
    await click_button(page.locator('.preview'), 'Build it')
    await expect.poll(async () => (await versions_of(design_id)).length, {timeout: 60_000})
        .toBe(1)
    const [version] = await versions_of(design_id)
    await expect.poll(() => requested, {timeout: 60_000}).toEqual([version!.id])

    // ...and never compiled here: nothing published it while the stubbed server sat on it
    await page.waitForTimeout(3000)
    expect((await versions_of(design_id))[0]!.data['status']).toBe('pending')
})


test('a tab that died mid-compile switches the phone to the server', async ({page}) => {
    // The marker a compile leaves while it runs, as a tab killed for memory leaves it behind
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('booted')){
            sessionStorage.setItem('booted', '1')
            localStorage.setItem('compile_in_flight', String(Date.now()))
        }
    })
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: true})
    await page.goto(`/designs/${design_id}`)
    await expect(page.getByRole('button', {name: 'Preview', exact: true})
        .locator('visible=true')).toHaveCount(1, {timeout: 60_000})
    // Provisionally, until the server has done a job of its own (see settle_server_mode)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('compile_on_server')))
        .toBe('provisional')
    expect(await page.evaluate(() => localStorage.getItem('compile_in_flight'))).toBe(null)
})


test('example designs are inline, and hidden once there are designs', async ({page}) => {
    // No designs yet: the examples are open from the start, since there's no list to bury
    const uid = await boot(page)
    const examples = page.locator('.examples .card')
    await expect(examples.first()).toBeVisible({timeout: 60_000})
    await click_button(page, 'Hide suggestions')
    await expect(examples).toHaveCount(0)

    // With a design of their own they start hidden, under it
    await seed_own_design(uid)
    await page.reload()
    // (the list row, not the navbar's recent-designs tab of the same name)
    await expect(page.getByRole('listitem').getByText('Compile journey'))
        .toBeVisible({timeout: 60_000})
    await expect(examples).toHaveCount(0)
    await click_button(page, 'Show suggestions')
    await expect(examples.first()).toBeVisible()

    // ...and still create a design of the user's own when clicked
    await examples.filter({hasText: /Tyndale study notes/}).click()
    await expect.poll(async () => (await owned_designs(uid)).length, {timeout: 30_000}).toBe(2)
})


test('the about page plays the intro video inline', async ({page}) => {
    await boot(page, '/about')
    await expect(page.locator('.display')).toHaveCount(0)
    await expect(page.locator('iframe[src*="lets.church/embed"]')).toBeAttached()
})
