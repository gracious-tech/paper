// The journeys that exercise the render path itself: a design with real scripture in it,
// compiled to a PDF in the browser by the Typst WASM worker and uploaded to Storage.
//
// The scripture comes from production fetch.bible and the fonts and WASM from
// assets.paper.bible (see stack.ts), so these are also the journeys that notice those services
// changing shape under the app.

import {test, expect, boot, build_version, design_data, versions_of} from './fixtures'
import {admin_bucket, seed_own_design, COMPILE_BIBLE, COMPILE_BOOK} from './helpers/admin'
import {storage_url} from './stack'


// A real compile is seconds of WASM work on top of starting the worker and loading fonts
test.describe.configure({timeout: 5 * 60 * 1000})


test('building compiles a real PDF and uploads it', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)

    await page.goto(`/designs/${design_id}`)
    const version = await build_version(page, design_id)

    // Clicking froze the design into a version of the caller's own and navigated to it
    expect(version.data['design_id']).toBe(design_id)
    expect(version.data['owner']).toBe(uid)
    await expect(page).toHaveURL(
        new RegExp(`/designs/${design_id}/${version.id}$`), {timeout: 60_000})

    expect(version.data['error'] ?? null).toBe(null)
    expect(version.data['status']).toBe('available')
    // A plausible length for one short letter, not merely "more than nothing" — a render that
    // dropped its text would still report a page, and this is a home-print booklet so the count
    // is imposed sheet sides rather than reader pages
    expect(version.data['pages']).toBeGreaterThanOrEqual(1)
    expect(version.data['pages']).toBeLessThanOrEqual(8)

    // The frozen blueprint is what was published, not what the design holds now
    const blueprint = version.data['blueprint'] as {bibles:string[], content:{book:string}[]}
    expect(blueprint.bibles).toEqual([COMPILE_BIBLE])
    expect(blueprint.content.map(item => item.book)).toEqual([COMPILE_BOOK])

    // ...and the PDF itself is in Storage, at the path the rules pin rather than any the doc
    // could have named
    const pdf_path = `versions/${version.id}/doc.pdf`
    expect(version.data['pdf_path']).toBe(pdf_path)

    const file = admin_bucket.file(pdf_path)
    expect((await file.exists())[0]).toBe(true)
    const [bytes] = await file.download()
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)

    // The design's denormalised summary follows the version it just produced, so the designs
    // list doesn't keep offering to generate what was already generated. It's a write of its
    // own after the version's, so it can land a moment after the version reads as available
    const summary_of = (data:Record<string, unknown>) =>
        data['latest_version'] as {status:string, pages:number, save_token:string}
    await expect.poll(async () => summary_of(await design_data(design_id)).status)
        .toBe('available')
    const design = await design_data(design_id)
    const summary = summary_of(design)
    expect(summary.pages).toBe(version.data['pages'])
    // design_needs_editor compares these by equality, so a copied token means "nothing
    // unrendered since" — the whole point of freezing it at click time
    expect(summary.save_token).toBe(design['save_token'])
    expect(version.data['save_token']).toBe(design['save_token'])

    // The finished document is shown, ready to download
    await expect(page.locator('.version .doc iframe')).toBeVisible({timeout: 60_000})
    await expect(page.getByRole('button', {name: 'Download interior'})).toBeVisible()
})


test('the compiled PDF is readable by version id alone', async ({page, context}) => {
    // A version id is the whole capability, so the rendered PDF must come back to a caller with
    // no claim on the design beyond knowing the id — including one who has never signed in
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)

    await page.goto(`/designs/${design_id}`)
    const version = await build_version(page, design_id)
    expect(version.data['status']).toBe('available')

    // Fetched through a plain request carrying none of the app's credentials
    const response = await context.request.get(storage_url(`versions/${version.id}/doc.pdf`))
    expect(response.status()).toBe(200)
    expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
})


test('building again after an edit adds a second version', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid)
    await page.goto(`/designs/${design_id}`)
    const first = await build_version(page, design_id)

    // Back to the editor from the latest version, and change something that shows in print
    await page.locator('.version_list .v-list-item').filter({hasText: 'Latest version'})
        .getByRole('button', {name: 'Edit', exact: true}).click()
    await page.getByLabel('Verse numbers').uncheck()
    await expect.poll(async () => (await design_data(design_id))['save_token'])
        .not.toBe(first.data['save_token'])

    const second = await build_version(page, design_id, 2)
    expect(second.id).not.toBe(first.id)
    expect(second.data['status']).toBe('available')
    expect((second.data['blueprint'] as {show_verses:boolean}).show_verses).toBe(false)
    // The earlier version is frozen as it was
    const earlier = (await versions_of(design_id)).find(version => version.id === first.id)!
    expect((earlier.data['blueprint'] as {show_verses:boolean}).show_verses).toBe(true)

    // Both are listed, newest as the latest
    await expect(page.getByText('Previous versions')).toBeVisible()
})


test('a design with no content can\'t be built', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {content_items: {}, content_order: []})
    await page.goto(`/designs/${design_id}`)

    await expect(page.getByLabel('Name')).toBeVisible({timeout: 60_000})
    await expect(page.getByRole('button', {name: 'Build it', exact: true}).first())
        .toBeDisabled()
})
