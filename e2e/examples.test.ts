
// The example designs beside the designs list: clicking one creates a real design pre-filled to
// match, owned by the user, rather than opening a shared read-only copy

import {test, expect, boot, design_data, only_design, UI_TIMEOUT} from './fixtures'


test.describe.configure({timeout: UI_TIMEOUT})


test('an example becomes a design of the user\'s own', async ({page}) => {
    const uid = await boot(page)

    await page.locator('.examples .card').filter({hasText: /Tyndale study notes/}).click()

    const design_id = await only_design(uid)
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}$`), {timeout: 30_000})
    const design = await design_data(design_id)
    const blueprint = design['blueprint'] as Record<string, unknown>
    const items = design['content_items'] as Record<string, {book:string}>
    // The study example: Ephesians, with Tyndale's notes and a cover, printed at home
    expect((design['content_order'] as string[]).map(id => items[id]!.book)).toEqual(['eph'])
    expect(blueprint['notes']).toBe('eng_tyndale')
    expect(blueprint['cover']).not.toBe(null)
    expect(blueprint['service_id']).toBe('home')
})


test('"Create a new design" opens the wizard instead', async ({page}) => {
    await boot(page)
    await page.getByRole('button', {name: 'Create a new design', exact: true}).click()
    await expect(page.getByText('What do you want it to look like?')).toBeVisible()
})
