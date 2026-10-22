
// The cover, which is designed in the bookcover widget embedded from cover-widget.paper.bible
// (another repo, production build — see stack.ts). The app and the widget only meet through
// their postMessage protocol (InitMessage in, 'ready'/'finished'/'cancelled' out), so this is
// the one place a change on either side of it would show

import {test, expect, boot, click_button, confirm_dialog, design_data} from './fixtures'
import {seed_own_design} from './helpers/admin'

import type {Page} from '@playwright/test'


// The widget renders its preview as it loads, which is a few seconds of its own
test.describe.configure({timeout: 3 * 60 * 1000})


// The stored cover config, or null
async function stored_cover(design_id:string):Promise<unknown>{
    return ((await design_data(design_id))['blueprint'] as {cover:unknown}).cover
}


// Open the full editor on a seeded design with no cover
async function open_editor(page:Page):Promise<string>{
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)
    await expect(page.getByText('This design does not currently include a cover.'))
        .toBeVisible({timeout: 60_000})
    return design_id
}


test('adding a cover in the widget, then removing it', async ({page}) => {
    const design_id = await open_editor(page)

    await click_button(page, 'Add cover')
    const overlay = page.locator('.cover_editor')
    await expect(overlay).toBeVisible()
    // The escape hatch only shows until the widget says it's ready
    await expect(overlay.getByRole('button')).toBeHidden({timeout: 2 * 60 * 1000})

    // Finishing in the widget hands its config back to the app over postMessage
    const widget = page.frameLocator('.cover_editor iframe')
    await widget.getByRole('button', {name: /finish/i}).click()
    await expect(overlay).toBeHidden({timeout: 60_000})
    await expect.poll(() => stored_cover(design_id), {timeout: 30_000}).not.toBe(null)
    await expect(page.getByText('This book has a cover design')).toBeVisible()

    // Removing asks first, and discards the config rather than disabling it
    await click_button(page, 'Remove cover')
    await expect(confirm_dialog(page).getByText('Remove this cover design?')).toBeVisible()
    await click_button(confirm_dialog(page), 'OK')
    await expect.poll(() => stored_cover(design_id), {timeout: 30_000}).toBe(null)
})


// Open the widget, type a subtitle, then press Finished, which asks what to do with an edit
async function edit_then_finish(page:Page):Promise<void>{
    await click_button(page, 'Add cover')
    await expect(page.locator('.cover_editor').getByRole('button'))
        .toBeHidden({timeout: 2 * 60 * 1000})
    const widget = page.frameLocator('.cover_editor iframe')
    // The subtitle is the widget's first multi-line field (the title lines are single-line)
    await widget.locator('textarea').first().fill('A journey subtitle')
    await widget.getByRole('button', {name: /finish/i}).click()
    await expect(widget.getByText('Save changes to cover?')).toBeVisible()
}


test('discarding an edit in the widget leaves the design without a cover', async ({page}) => {
    const design_id = await open_editor(page)

    // The widget has no Cancel button: discarding at the finish prompt is how it cancels
    await edit_then_finish(page)
    await page.frameLocator('.cover_editor iframe')
        .getByRole('button', {name: 'Discard', exact: true}).click()

    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})
    expect(await stored_cover(design_id)).toBe(null)
    await expect(page.getByText('This design does not currently include a cover.')).toBeVisible()
})


test('saving an edit in the widget stores it in the design', async ({page}) => {
    const design_id = await open_editor(page)

    await edit_then_finish(page)
    await page.frameLocator('.cover_editor iframe')
        .getByRole('button', {name: 'Save', exact: true}).click()

    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})
    await expect.poll(async () => {
        const cover = await stored_cover(design_id) as {form:{subtitle?:string}}|null
        return cover?.form.subtitle
    }, {timeout: 30_000}).toBe('A journey subtitle')
})
