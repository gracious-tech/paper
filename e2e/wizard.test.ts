
// The new-design wizard: five steps that only become a design when the last one is confirmed.
// Each journey checks the design the app actually wrote, not just where the UI ended up — the
// wizard's choices are applied to a blueprint in one go at the end (build_new_blueprint), so a
// step that looked right on screen can still be dropped on the way to Firestore

import {test, expect, boot, click_button, confirm_dialog, design_data, only_design, owned_designs,
    UI_TIMEOUT}
    from './fixtures'

import type {Page, Locator} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// The wizard dialog, opened from the navbar's "New"
async function open_wizard(page:Page):Promise<Locator>{
    await page.getByRole('button', {name: 'New', exact: true}).click()
    const wizard = page.locator('.wizard')
    await expect(wizard.getByText('What do you want it to look like?')).toBeVisible()
    return wizard
}


// The step the wizard is showing. Every step stays mounted (a v-window), so anything not scoped
// to this one can match a hidden card on another step
function current_step(wizard:Locator):Locator{
    return wizard.locator('.v-window-item--active')
}


// The wizard's footer button that moves on (or, on the last step, creates)
function next_button(wizard:Locator, name:'Next'|'Confirm' = 'Next'):Locator{
    return wizard.locator('.v-card-actions').getByRole('button', {name, exact: true})
}


// Choose a design type, which moves straight on to the books step
async function choose_type(wizard:Locator, label:string):Promise<void>{
    await current_step(wizard).getByText(label, {exact: true}).click()
    await expect(wizard.getByText('What books of the Bible do you want included?')).toBeVisible()
}


// Pick whole books by name, then move on to the translations step
async function choose_books(wizard:Locator, names:string[]):Promise<void>{
    for (const name of names){
        await current_step(wizard).locator('.v-list-item')
            .filter({hasText: new RegExp(`^${name}$`)}).click()
    }
    await expect(wizard.getByText(`${names.length} included`)).toBeVisible()
    await next_button(wizard).click()
    await expect(wizard.getByText('What Bible translation would you like to use?')).toBeVisible()
}


// Accept the translation step's default and print at home, landing on the cover step
async function home_print(wizard:Locator):Promise<void>{
    await next_button(wizard).click()
    await expect(wizard.getByText('How would you like to print it?')).toBeVisible()
    await current_step(wizard).getByText('At home', {exact: true}).click()
    await expect(wizard.getByText('Your printer\'s paper size')).toBeVisible()
    await next_button(wizard).click()
    await expect(wizard.getByText('What do you want the cover to look like?')).toBeVisible()
}


// The translation picker's dialog, told apart from the wizard beneath it by its footer link
function translation_picker(page:Page):Locator{
    return page.locator('.v-overlay--active .v-card')
        .filter({hasText: 'Can\'t find a translation?'})
}


// Pick the cover step's first style and confirm, which creates the design
async function finish(wizard:Locator, title = ''):Promise<void>{
    if (title){
        await current_step(wizard).getByLabel('Title').fill(title)
    }
    // The cover cards drop their labels once their previews render, so they're picked by place
    await current_step(wizard).locator('.grid .v-card').first().click()
    await next_button(wizard, 'Confirm').click()
    await expect(wizard).toBeHidden({timeout: 30_000})
}


test('a regular Bible booklet, built step by step', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)

    await choose_type(wizard, 'Regular Bible')
    await choose_books(wizard, ['Ruth', 'Philemon'])
    await home_print(wizard)
    await finish(wizard, 'Two short books')

    // Created, opened, and named after the cover's title
    const design_id = await only_design(uid)
    await expect(page).toHaveURL(new RegExp(`/designs/${design_id}$`))
    await expect(page.locator('.navbar').getByText('Two short books')).toBeVisible()

    const design = await design_data(design_id)
    const blueprint = design['blueprint'] as Record<string, unknown>
    // One whole-book passage per book, in canonical order rather than the order clicked
    const order = design['content_order'] as string[]
    const items = design['content_items'] as Record<string, {type:string, book:string,
        start_chapter:number|null}>
    expect(order.map(id => items[id]!.book)).toEqual(['rut', 'phm'])
    expect(order.every(id => items[id]!.type === 'passage'
        && items[id]!.start_chapter === null)).toBe(true)
    // Home printing is always a booklet, on the printer's paper
    expect(blueprint['service_id']).toBe('home')
    expect(blueprint['booklet']).toBe(true)
    expect(['a4', 'us_letter']).toContain(blueprint['size_id'])
    expect((blueprint['bibles'] as string[]).length).toBe(1)
    expect(blueprint['cover']).not.toBe(null)
    // The wizard's choices are kept beside the blueprint, and the simple editor opens first
    expect(design['simple_mode']).toBe(true)
    const draft = design['wizard_draft'] as Record<string, unknown>
    expect(draft['type']).toBe('regular')
    expect(draft['title']).toBe('Two short books')
    expect(draft['books']).toEqual(['rut', 'phm'])
})


test('a type\'s preset is applied to the blueprint', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)

    await choose_type(wizard, 'Reading Bible')
    await choose_books(wizard, ['Jonah'])
    await home_print(wizard)
    await finish(wizard)

    const blueprint = (await design_data(await only_design(uid)))['blueprint'] as
        Record<string, unknown>
    // "No verse numbers, like a normal book"
    expect(blueprint['show_verses']).toBe(false)
    expect(blueprint['show_chapters']).toBe(false)
    expect(blueprint['show_headings']).toBe(false)
    expect(blueprint['show_footnotes']).toBe(false)
})


test('specific passages instead of whole books', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)
    await choose_type(wizard, 'Regular Bible')

    await current_step(wizard).getByRole('button', {name: 'List specific passages', exact: true}).click()
    await current_step(wizard).getByLabel('Passages').fill('John 3:16-21\nPsalm 23\nnot a passage')
    await current_step(wizard).getByRole('button', {name: 'Add', exact: true}).click()

    // Each line is parsed on its own, and one that isn't a reference is flagged, not dropped
    const rows = wizard.locator('.passage_row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2).locator('.status.text-error')).toBeVisible()
    await expect(wizard.getByText('2 included')).toBeVisible()

    await next_button(wizard).click()
    await home_print(wizard)
    await finish(wizard)

    const design = await design_data(await only_design(uid))
    const order = design['content_order'] as string[]
    const items = design['content_items'] as Record<string, Record<string, unknown>>
    // The user's own order, and only the lines that parsed
    expect(order.map(id => {
        const item = items[id]!
        return [item['book'], item['start_chapter'], item['start_verse'], item['end_verse']]
    })).toEqual([['jhn', 3, 16, 21], ['psa', 23, null, null]])
})


test('professional printing picks a trim size, not a paper size', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)
    await choose_type(wizard, 'Regular Bible')
    await choose_books(wizard, ['Mark'])
    await next_button(wizard).click()

    await current_step(wizard).getByText('Professionally', {exact: true}).click()
    // No size is assumed for a real book, so the step can't be passed until one is chosen
    await expect(next_button(wizard)).toBeDisabled()
    await current_step(wizard).locator('.choice').filter({hasText: 'Medium'}).click()
    await next_button(wizard).click()
    await finish(wizard)

    const blueprint = (await design_data(await only_design(uid)))['blueprint'] as
        Record<string, unknown>
    expect(blueprint['service_id']).toBe('lulu')
    expect(blueprint['size_id']).toBe('digest')
    expect(blueprint['booklet']).toBe(false)
})


test('choosing a different translation', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)
    await choose_type(wizard, 'Regular Bible')
    await choose_books(wizard, ['Philemon'])

    // The primary slot opens the picker on its own language's translations
    await current_step(wizard).locator('.v-list-item').first().click()
    const picker = translation_picker(page)
    await picker.getByRole('button', {name: 'Languages', exact: true}).click()
    await picker.getByPlaceholder('Search...').fill('Spanish')
    await picker.locator('.v-list-item').filter({hasText: '(Spanish)'}).first().click()
    // Then the first translation listed for it
    const first_translation = picker.locator('.v-list-item').filter({hasText: '—'}).first()
    const label = (await first_translation.locator('.v-list-item-title').innerText())
    await first_translation.click()
    // Choosing closes the picker by itself
    await expect(picker).toBeHidden()
    await expect(current_step(wizard).locator('.v-list-item').first())
        .toContainText(label.split('—')[1]!.trim().slice(0, 10))

    await home_print(wizard)
    await finish(wizard)

    const bibles = ((await design_data(await only_design(uid)))['blueprint'] as
        {bibles:string[]}).bibles
    expect(bibles).toHaveLength(1)
    expect(bibles[0]).toMatch(/^spa_/)
})


test('two translations of the same Bible are refused', async ({page}) => {
    await boot(page)
    const wizard = await open_wizard(page)
    await choose_type(wizard, 'Bilingual Bible')
    await choose_books(wizard, ['Philemon'])

    // Add the same translation as the primary into the second slot
    const primary = await current_step(wizard).locator('.v-list-item').first().innerText()
    await current_step(wizard).getByText('Add additional translation').click()
    const picker = translation_picker(page)
    await picker.locator('.v-list-item').filter({hasText: primary.trim()}).first().click()
    await expect(picker).toBeHidden()

    await expect(wizard.getByText('The two translations must be different')).toBeVisible()
    await expect(next_button(wizard)).toBeDisabled()
})


test('closing the wizard asks first, and creates nothing', async ({page}) => {
    const uid = await boot(page)
    const wizard = await open_wizard(page)
    await choose_type(wizard, 'Regular Bible')
    await choose_books(wizard, ['Philemon'])

    await page.keyboard.press('Escape')
    await expect(page.getByText('Closing now will discard the design.')).toBeVisible()
    // Cancelling the confirmation keeps the wizard where it was
    await confirm_dialog(page).getByRole('button', {name: 'Cancel', exact: true}).click()
    await expect(wizard.getByText('What Bible translation would you like to use?')).toBeVisible()

    await page.keyboard.press('Escape')
    await confirm_dialog(page).getByRole('button', {name: 'OK', exact: true}).click()
    await expect(wizard).toBeHidden()
    expect(await owned_designs(uid)).toEqual([])

    // And opening it again starts over
    const reopened = await open_wizard(page)
    await expect(reopened.getByText('What do you want it to look like?')).toBeVisible()
})


test('the simple editor reopens a step, and "More options" leaves it for good',
    async ({page}) => {
        const uid = await boot(page)
        const wizard = await open_wizard(page)
        await choose_type(wizard, 'Regular Bible')
        await choose_books(wizard, ['Philemon'])
        await home_print(wizard)
        await finish(wizard)
        const design_id = await only_design(uid)

        // Simple mode summarises each step as a row
        await page.getByRole('button', {name: 'Content Philemon'}).click()

        // Clicking a row reopens just that step, and Done applies it to the design itself
        const step = page.locator('.v-card').filter({hasText: 'What books of the Bible'})
        await step.locator('.v-list-item').filter({hasText: /^Jude$/}).click()
        await click_button(step, 'Done')
        await expect(page.getByRole('button', {name: /^Content Philem\w*, Jude/})).toBeVisible()
        await expect.poll(async () => {
            const design = await design_data(design_id)
            const items = design['content_items'] as Record<string, {book:string}>
            return (design['content_order'] as string[]).map(id => items[id]!.book)
        }, {timeout: 30_000}).toEqual(['phm', 'jud'])

        // Switching to the full editor is remembered on the design, not just this tab
        await page.getByRole('button', {name: 'More options', exact: true}).click()
        await expect(page.getByLabel('Name')).toBeVisible()
        await expect.poll(async () => (await design_data(design_id))['simple_mode'],
            {timeout: 30_000}).toBe(false)
        await page.reload()
        await expect(page.getByLabel('Name')).toBeVisible({timeout: 60_000})
    })
