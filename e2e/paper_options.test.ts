// The editor's paper options: the printing service decides which sizes, bindings, inks and
// papers are offered, and switching it resets each to something that service actually makes.
// Each choice is checked where it lands, the design doc, which every compile reads from

import {get_service} from 'printing-services'

import {test, expect, boot, design_data, UI_TIMEOUT} from './fixtures'
import {seed_own_design} from './helpers/admin'

import type {Page} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// The design's stored blueprint fields
async function stored(design_id:string):Promise<Record<string, unknown>>{
    return (await design_data(design_id))['blueprint'] as Record<string, unknown>
}


// Open the full editor on a seeded design holding just Philemon (home-printed A4 booklet)
async function open_editor(page:Page):Promise<string>{
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)
    await expect(page.getByLabel('Printing service')).toBeVisible({timeout: 60_000})
    return design_id
}


// Pick an option from one of the panel's dropdowns, by its label and the option's text
async function choose(page:Page, label:string, option:string|RegExp):Promise<void>{
    await page.getByLabel(label, {exact: true}).click({force: true})
    // Only what's showing, since a closing menu is still in the page while it fades out
    await page.getByRole('option').locator('visible=true').filter({hasText: option}).first()
        .click()
}


// Pick a dropdown's last option. A long list renders only what's scrolled into view, and
// moves under the pointer as it's scrolled, so this goes by keyboard as a user could
async function choose_last(page:Page, label:string):Promise<void>{
    await page.getByLabel(label, {exact: true}).click({force: true})
    await expect(page.getByRole('option').locator('visible=true').first()).toBeVisible()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
}


test('a print service resets the options to what it makes', async ({page}) => {
    const design_id = await open_editor(page)

    // Lulu: no folding, its own first size, and a binding, ink and paper it offers together
    await choose(page, 'Printing service', /^Lulu/)
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['service_id'], blueprint['booklet'], blueprint['binding_type'],
            blueprint['ink_type'], blueprint['paper_type']]
    }).toEqual(['lulu', false, 'paperback', 'bw', 'cream'])

    // Its other bindings are offered beside it
    await choose(page, 'Binding', 'Paperback Coil Bound')
    await expect.poll(async () => (await stored(design_id))['binding_type'])
        .toBe('paperback_coil')

    // Lulu has too many sizes for buttons, so they're a dropdown ending in "Custom"
    await choose_last(page, 'Page size')
    await expect.poll(async () => (await stored(design_id))['size_id']).toBe('')
    await page.getByLabel('Width', {exact: true}).fill('150')
    await expect.poll(async () => (await stored(design_id))['custom_trim_width']).toBe(150)

    // A custom size is still printed by Lulu, so its binding stays a choice
    await choose(page, 'Binding', 'Paperback Perfect Bound')
    await expect.poll(async () => (await stored(design_id))['binding_type']).toBe('paperback')

    // Switching unit converts what's there rather than reinterpreting it
    await page.locator('.dims').getByRole('button', {name: 'inch', exact: true}).click()
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['custom_unit'], blueprint['custom_trim_width']]
    }).toEqual(['inch', 5.906])
})


test('a service needing ink and paper for its cover asks for both', async ({page}) => {
    const design_id = await open_editor(page)
    const kdp = get_service('kdp')
    const name_of = (items:{id:string, name:string}[], id:string) =>
        new RegExp(`^${items.find(item => item.id === id)!.name}$`)
    await choose(page, 'Printing service', /^Kindle Direct Publishing/)
    await expect.poll(async () => (await stored(design_id))['service_id']).toBe('kdp')
    await expect(page.getByLabel('Ink type', {exact: true})).toBeVisible()

    await choose(page, 'Paper type', name_of(kdp.get_paper_types({all: true}), 'cream'))
    await expect.poll(async () => (await stored(design_id))['paper_type']).toBe('cream')

    // Colour is only printed on white, so the paper follows the ink
    await choose(page, 'Ink type', name_of(kdp.get_ink_types({all: true}), 'color'))
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['ink_type'], blueprint['paper_type']]
    }).toEqual(['color', 'white'])
})


test('a few sizes are buttons, and a custom service takes bleed and spine', async ({page}) => {
    const design_id = await open_editor(page)

    // ctrlPrint has few enough sizes to show them all at once
    await choose(page, 'Printing service', /^ctrlPrint/)
    await expect.poll(async () => (await stored(design_id))['service_id']).toBe('ctrlprint')
    await page.getByRole('button', {name: 'Custom', exact: true}).click()
    await expect.poll(async () => (await stored(design_id))['size_id']).toBe('')

    // Self-managed printing: a common size to start with, the cover's bleed and spine, and it
    // can still be folded in half
    await choose(page, 'Printing service', /^Custom/)
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['service_id'], blueprint['binding_type']]
    }).toEqual(['custom', 'paperback'])
    expect((await stored(design_id))['size_id']).not.toBe('')
    await page.getByLabel('Bleed', {exact: true}).fill('5')
    await page.getByLabel('Spine width', {exact: true}).fill('12')
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['custom_bleed'], blueprint['custom_spine']]
    }).toEqual([5, 12])

    // Back home, the size is one a home printer takes
    await choose(page, 'Printing service', /^Print at home/)
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['service_id'], blueprint['size_id']]
    }).toEqual(['home', 'a4'])
})


test('a binding the document is too short for is warned about', async ({page}) => {
    await open_editor(page)
    // Philemon is a few pages, far short of what a perfect-bound paperback needs. The warning
    // waits for the preview's page estimate, so it comes from a real compile
    await choose(page, 'Printing service', /^Lulu/)
    await expect(page.getByText(/Paperback Perfect Bound binding requires at least \d+ pages/))
        .toBeVisible({timeout: 120_000})
})
