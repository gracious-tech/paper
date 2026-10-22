
// The phone layout, below AppRoot's 900px breakpoint, run by the config's `mobile` project.
// AppRoot mounts no preview pane there at all, so whatever the pane does on desktop has to
// happen some other way: the page-count estimate a build freezes is measured on demand
// (ensure_page_estimate) rather than kept current by the live preview, the downloads move into
// the versions list, and the example designs and intro video sit inline

import {test, expect, boot, build_version, click_button, owned_designs, UI_TIMEOUT}
    from './fixtures'
import {seed_own_design} from './helpers/admin'


test.describe.configure({timeout: UI_TIMEOUT})


test('there is no preview pane', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)

    await expect(page.getByLabel('Name')).toBeVisible({timeout: 60_000})
    // Not mounted rather than hidden, so nothing compiles previews nobody can see
    await expect(page.locator('.display')).toHaveCount(0)
    await expect(page.getByRole('button', {name: 'Build it', exact: true})
        .locator('visible=true')).toHaveCount(1)
})


test('building from the simple editor, then downloading', async ({page}) => {
    // A real compile, like compile.test.ts's, so it gets that suite's budget
    test.setTimeout(5 * 60 * 1000)
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: true})
    await page.goto(`/designs/${design_id}`)

    // Simple mode derives the binding from the page estimate, which with no preview pane the
    // build has to measure first — a build that skipped it would freeze a guess
    const version = await build_version(page, design_id)
    expect(version.data['error'] ?? null).toBe(null)
    expect(version.data['status']).toBe('available')
    expect(version.data['pages']).toBeGreaterThanOrEqual(1)

    // The downloads the desktop shows in the preview toolbar are in the versions list instead
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}/${version.id}$`))
    const downloading = page.waitForEvent('download')
    await click_button(page.locator('.mobile_actions'), 'Download interior')
    expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/)
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
