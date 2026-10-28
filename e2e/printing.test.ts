// Getting a finished version printed: the printing guidance for each kind of printing service,
// and Lulu's cost estimate. The estimate's print price comes from the app's own table and its
// delivery quote from Lulu's public endpoint, which is stubbed here so the journey neither
// depends on lulu.com nor sends it anything

import {get_service} from 'printing-services'

import {test, expect, boot, click_button, active_dialog, UI_TIMEOUT} from './fixtures'
import {admin_bucket, admin_db, design_doc, MINIMAL_PDF, new_id, version_doc}
    from './helpers/admin'

import type {Page, Route} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// The Lulu product a5 black-and-white paperback on white paper makes (see lulu_skus.ts)
const LULU_SKU = '0583X0827.BW.STD.PB.060UW444.MXX'

// Lulu's delivery quote, as its shipping-options endpoint answers: an inactive option and a
// pricier one either side of the cheapest, which is the one quoted
const SHIPPING_OPTIONS = [
    {level: 'EXPRESS', carrier_service_name: 'Speedy Express', cost_excl_tax: 25,
        is_active: true, total_days_min: 2, total_days_max: 3},
    {level: 'MAIL', carrier_service_name: 'Slow Mail', cost_excl_tax: 4.5,
        is_active: true, total_days_min: 10, total_days_max: 14},
    {level: 'GROUND', carrier_service_name: 'Retired Ground', cost_excl_tax: 1,
        is_active: false, total_days_min: null, total_days_max: null},
]


// Seed one of the browser user's own designs whose latest version (with its stand-in PDF) was
// built for a given printing service, returning its design id
async function seed_printed(uid:string, blueprint_fields:Record<string, unknown>, pages = 120)
        :Promise<string>{
    const design_id = new_id()
    const version_id = new_id()
    const base = version_doc(design_id, version_id, uid)
    await admin_db.doc(`designs/${design_id}`).set(design_doc(uid, {
        latest_version: {status: 'available', pages, save_token: 'save_token_value'}}))
    await admin_db.doc(`versions/${version_id}`).set(version_doc(design_id, version_id, uid, {
        pages, blueprint: {...base['blueprint'] as object, ...blueprint_fields}}))
    await admin_bucket.file(`versions/${version_id}/doc.pdf`)
        .save(MINIMAL_PDF, {contentType: 'application/pdf'})
    return design_id
}


// A Lulu paperback, which Lulu prints and so can be priced
const LULU_PAPERBACK = {service_id: 'lulu', size_id: 'a5', binding_type: 'paperback',
    ink_type: 'bw', paper_type: 'white', booklet: false}


// Answer Lulu's shipping-options endpoint (preflight included, as it's a cross-origin JSON
// POST) with `status` and SHIPPING_OPTIONS, recording each quote's request body
async function stub_lulu(page:Page, status = 200):Promise<Record<string, unknown>[]>{
    const quotes:Record<string, unknown>[] = []
    await page.route('https://api.lulu.com/shipping-options/', async (route:Route) => {
        const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
        if (route.request().method() === 'OPTIONS'){
            await route.fulfill({status: 204, headers: cors})
            return
        }
        quotes.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({status, headers: cors, contentType: 'application/json',
            body: JSON.stringify(status === 200 ? SHIPPING_OPTIONS : {detail: 'unavailable'})})
    })
    return quotes
}


// Open a seeded design's latest version and one of its toolbar's dialogs
async function open_from_toolbar(page:Page, design_id:string, button:string):Promise<void>{
    await page.goto(`/designs/${design_id}`)
    await page.locator('.version .toolbar').getByRole('button', {name: button})
        .click({timeout: 60_000})
}


test('a Lulu book is priced with its cheapest delivery, then re-priced', async ({page}) => {
    const quotes = await stub_lulu(page)
    const uid = await boot(page)
    const design_id = await seed_printed(uid, LULU_PAPERBACK)

    await open_from_toolbar(page, design_id, 'Estimate cost')
    const dialog = active_dialog(page)
    await expect(dialog).toContainText('Slow Mail, around 10–14 days')
    await expect(dialog).toContainText('Prices shown in USD')
    await expect(dialog.locator('dd.delivery')).toHaveText('$4.50')
    // The browser is American, so that's where it's delivered unless told otherwise
    expect(quotes).toEqual([{currency: 'USD',
        line_items: [{page_count: 120, pod_package_id: LULU_SKU, quantity: 1}],
        shipping_address: {country: 'US'}}])

    // More copies are quoted together, with their combined price on a line of its own
    await dialog.getByLabel('Copies').fill('3')
    await expect(dialog).toContainText('3 books')
    expect((quotes.at(-1)!['line_items'] as {quantity:number}[])[0]!.quantity).toBe(3)

    // Another country is quoted in the currency Lulu prices it in, and is remembered
    await dialog.getByLabel('Deliver to').fill('Australia')
    await page.getByRole('option', {name: 'Australia', exact: true}).click()
    await expect(dialog).toContainText('Prices shown in AUD')
    expect(quotes.at(-1)).toMatchObject({currency: 'AUD', shipping_address: {country: 'AU'}})
    await click_button(dialog, 'Close')
    await page.locator('.version .toolbar').getByRole('button', {name: 'Estimate cost'}).click()
    await expect(active_dialog(page)).toContainText('Prices shown in AUD')
})


test.describe('when Lulu can\'t be reached', () => {
    test.use({expected_reports: /Lulu shipping options failed \(500\)/})

    test('the estimate says it couldn\'t be worked out', async ({page}) => {
        await stub_lulu(page, 500)
        const uid = await boot(page)
        const design_id = await seed_printed(uid, LULU_PAPERBACK)
        await open_from_toolbar(page, design_id, 'Estimate cost')
        await expect(active_dialog(page))
            .toContainText("The estimate couldn't be worked out. Please try again later.")
    })
})


test('a book longer than Lulu prints says so, without asking Lulu', async ({page}) => {
    const quotes = await stub_lulu(page)
    const uid = await boot(page)
    const design_id = await seed_printed(uid, LULU_PAPERBACK, 2000)
    await open_from_toolbar(page, design_id, 'Estimate cost')
    await expect(active_dialog(page)).toContainText("Lulu can't print this book at this length.")
    expect(quotes).toEqual([])
})


test('Lulu\'s walkthrough names the binding to pick, and downloads the PDFs', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_printed(uid, LULU_PAPERBACK)
    await open_from_toolbar(page, design_id, 'How to print')

    const dialog = active_dialog(page)
    await expect(dialog).toContainText('How to print with Lulu')
    // One step at a time: the interior's step downloads it, the options step names the binding
    await click_button(dialog, '3. Interior')
    const download = page.waitForEvent('download')
    await click_button(dialog, 'Download interior')
    expect((await download).suggestedFilename()).toBe('A shared document.pdf')
    await click_button(dialog, '4. Options')
    await expect(dialog).toContainText('The binding must be Paperback Perfect Bound.')
})


test('another service gets the exact specification and its own guide', async ({page}) => {
    const uid = await boot(page)
    const kdp = get_service('kdp')
    const design_id = await seed_printed(uid, {service_id: 'kdp', size_id: 'novella',
        binding_type: 'paperback', ink_type: 'bw', paper_type: 'cream', booklet: false})
    await page.goto(`/designs/${design_id}`)
    // Only Lulu can be priced
    await expect(page.locator('.version .toolbar .how_to_print')).toBeVisible({timeout: 60_000})
    await expect(page.locator('.version .toolbar .estimate_cost')).toHaveCount(0)
    await page.locator('.version .toolbar .how_to_print').click()

    const dialog = active_dialog(page)
    await expect(dialog).toContainText('How to print professionally')
    const spec = dialog.locator('dl.spec')
    for (const [label, value] of [
        ['Binding', kdp.get_binding_types({all: true}).find(item => item.id === 'paperback')!.name],
        ['Paper', kdp.get_paper_types({all: true}).find(item => item.id === 'cream')!.name],
    ]){
        await expect(spec).toContainText(label!)
        await expect(spec).toContainText(value!)
    }
    await expect(dialog.getByRole('link', {name: `${kdp.name} guide`}))
        .toHaveAttribute('href', kdp.url_guide || kdp.url_website)
})


test('single pages printed at home are stapled, not folded', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_printed(uid, {service_id: 'home', size_id: 'a4', booklet: false})
    await open_from_toolbar(page, design_id, 'How to print')
    await expect(active_dialog(page)).toContainText('How to print at home')
    await expect(active_dialog(page)).toContainText(/staple/i)
})
