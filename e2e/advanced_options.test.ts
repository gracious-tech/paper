// The editor's "Advanced options": the settings too fine-grained for the main panels, each
// checked where it lands — the design doc every compile reads. Some of them convert or depend
// on others (margins between units, the binding gutter on the printing service, a font from
// another design copied in when picked), which is what these journeys are about

import {createHash} from 'node:crypto'

import {test, expect, boot, click_button, design_data, UI_TIMEOUT} from './fixtures'
import {admin_bucket, admin_db, blueprint_options, design_doc, new_id, seed_own_design}
    from './helpers/admin'

import type {Page} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// The design's stored blueprint fields
async function stored(design_id:string):Promise<Record<string, unknown>>{
    return (await design_data(design_id))['blueprint'] as Record<string, unknown>
}


// Open a seeded design's full editor, then its advanced options, returning the panel
async function open_advanced(page:Page, design_id:string){
    await page.goto(`/designs/${design_id}`)
    await page.getByRole('button', {name: 'Advanced options', exact: true})
        .click({timeout: 60_000})
    const panel = page.locator('.v-card').filter({hasText: 'Border of images'})
    await expect(panel).toBeVisible()
    return panel
}


test('margins convert between units, and the title page and chapter settings', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    const panel = await open_advanced(page, design_id)

    // Printing at home there's no binding to size a gutter for, so it's left to the margin
    await expect(panel.getByLabel('Add auto-calculated gutter')).toBeDisabled()
    await expect(panel).toContainText('only available for known printing services')

    // Switching unit converts the margins rather than reinterpreting them
    await click_button(panel, 'inch')
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['margin_unit'], blueprint['margin_top'], blueprint['margin_inner']]
    }, {timeout: 30_000}).toEqual(['inch', 0.79, 0.59])

    // Title pages forced onto one side, and lines to write on in the blank pages
    await click_button(panel, 'Left')
    await click_button(panel, 'Narrow')
    await expect.poll(async () => {
        const blueprint = await stored(design_id)
        return [blueprint['titlepage_always'], blueprint['lines']]
    }, {timeout: 30_000}).toEqual(['left', 'narrow'])
    // And back to either side, which is stored as no preference at all
    await click_button(panel, 'Either side')
    await expect.poll(async () => (await stored(design_id))['titlepage_always']).toBe(null)

    // The margin number can't hang beside a second column, which the style says when chosen
    await panel.getByLabel('Style', {exact: true}).click({force: true})
    await page.getByRole('option').filter({hasText: 'Margin number'}).click()
    await expect(panel).toContainText('not available when there are two columns of text')
    await expect.poll(async () => (await stored(design_id))['show_chapters_style'])
        .toBe('float')

    await click_button(panel, 'Done')
    await expect(panel).toBeHidden()
})


test('a printing service that knows its gutter says how much it adds', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false, blueprint: {
        ...blueprint_options(), bibles: ['eng_bsb'], service_id: 'lulu', size_id: 'a5',
        binding_type: 'paperback', ink_type: 'bw', paper_type: 'white', booklet: false}})
    const panel = await open_advanced(page, design_id)

    const gutter = panel.getByLabel('Add auto-calculated gutter')
    await expect(gutter).toBeEnabled()
    await expect(gutter).toBeChecked()
    // (how much it adds follows the page estimate, which lands whenever the preview does)
    await expect(panel).toContainText('Adds additional inner margin in proportion to the page'
        + ' count.')

    // Turned off, it's off in the design too
    await gutter.uncheck()
    await expect.poll(async () => (await stored(design_id))['margin_gutter_auto']).toBe(false)
})


test('a font uploaded to another design is copied in when picked', async ({page}) => {
    // A real font (the same one cover.test.ts uploads), held by another of the user's designs
    test.setTimeout(2 * 60 * 1000)
    const uid = await boot(page)
    const response = await fetch(
        'https://assets.paper.bible/fonts/_noto/Noto%20Sans%20Adlam/NotoSansAdlam-Regular.otf')
    const bytes = Buffer.from(await response.arrayBuffer())
    const other_id = new_id()
    const other_path = `design_assets/${other_id}/${createHash('sha256').update(bytes)
        .digest('hex')}.bin`
    await admin_bucket.file(other_path).save(bytes, {contentType: 'font/otf'})
    await admin_db.doc(`designs/${other_id}`).set(design_doc(uid, {name: 'Another design',
        fonts: {font_1: {family: 'Noto Sans Adlam', style: 'sans', files: [other_path]}}}))
    const design_id = await seed_own_design(uid, {simple_mode: false})
    const panel = await open_advanced(page, design_id)

    // Offered last among the fonts for headings, under the other designs' fonts, and picking it
    // gives this design its own copy (the list is virtualised, so it's reached by keyboard)
    // (the list fills in as the font manifest and the other designs load, so End is pressed
    // again until it lands on the suggestion)
    const suggestion = page.getByRole('option').filter({hasText: 'Noto Sans Adlam'})
    await expect(async () => {
        if (!await page.getByRole('option').first().isVisible()){
            await panel.getByLabel('Font for headings', {exact: true}).click({force: true})
        }
        await page.keyboard.press('End')
        await expect(suggestion).toBeVisible({timeout: 2000})
    }).toPass({timeout: 60_000})
    await page.keyboard.press('Enter')
    await expect.poll(async () => {
        const design = await design_data(design_id)
        const fonts = Object.values(design['fonts'] as Record<string, {family:string,
            files:string[]}>)
        return [(design['blueprint'] as Record<string, unknown>)['font_headings'],
            fonts.map(font => font.family), fonts[0]?.files[0]?.startsWith(
                `design_assets/${design_id}/`)]
    }, {timeout: 60_000}).toEqual(['Noto Sans Adlam', ['Noto Sans Adlam'], true])
})
