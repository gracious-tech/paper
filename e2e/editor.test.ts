
// The full editor: building up a design's content and changing its options, each edit checked
// where it lands — the design doc in Firestore, which every other editor, every later version
// and every compile reads from. The sidebar preview is the one thing checked on screen, since
// it's the only place the WASM engine's output is shown before a version is built

import {test, expect, boot, click_button, design_data, UI_TIMEOUT} from './fixtures'
import {admin_db, seed_own_design, stub_server_preview, PREVIEW_SVG_PAGE} from './helpers/admin'

import type {Page} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// What the design's content list holds, in order, as the fields worth asserting on
async function stored_content(design_id:string):Promise<Record<string, unknown>[]>{
    const design = await design_data(design_id)
    const items = design['content_items'] as Record<string, Record<string, unknown>>
    return (design['content_order'] as string[]).map(id => items[id]!)
}


// A blueprint field, as stored
async function stored_option(design_id:string, field:string):Promise<unknown>{
    return ((await design_data(design_id))['blueprint'] as Record<string, unknown>)[field]
}


// Open the full editor on a seeded design holding just Philemon
async function open_editor(page:Page):Promise<string>{
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)
    await expect(content_rows(page)).toHaveCount(1, {timeout: 60_000})
    return design_id
}


// The rows of the editor's content list
function content_rows(page:Page){
    return page.locator('.cont .v-list .v-list-item').filter({has: page.locator('.v-chip')})
}


test('adding a passage', async ({page}) => {
    const design_id = await open_editor(page)

    await click_button(page.locator('.add'), 'Passage')
    const field = page.getByPlaceholder('Book or passage')
    await field.fill('Ruth 1:1-5')
    // The reference is parsed as it's typed, and read back to confirm what was understood
    await expect(page.locator('.passage-field .text-success')).toBeVisible()
    await click_button(page, 'Done')

    await expect(content_rows(page)).toHaveCount(2)
    await expect(content_rows(page).nth(1)).toContainText('Ruth 1:1-5')
    await expect.poll(async () => (await stored_content(design_id)).map(item =>
        [item['book'], item['start_chapter'], item['start_verse'], item['end_verse']]))
        .toEqual([['phm', null, null, null], ['rut', 1, 1, 5]])
})


test('a passage that doesn\'t parse can\'t be saved', async ({page}) => {
    const design_id = await open_editor(page)

    await click_button(page.locator('.add'), 'Passage')
    await page.getByPlaceholder('Book or passage').fill('Hezekiah 4')
    await expect(page.locator('.passage-field .text-error')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Done', exact: true})).toBeDisabled()

    // Cancelling adds nothing
    await click_button(page, 'Cancel')
    await expect(content_rows(page)).toHaveCount(1)
    expect(await stored_content(design_id)).toHaveLength(1)
})


test('editing a passage\'s title', async ({page}) => {
    const design_id = await open_editor(page)

    await content_rows(page).first().click()
    await expect(page.getByText('Edit passage')).toBeVisible()
    // The title follows the reference until "Auto" is turned off
    await page.getByLabel('Auto').uncheck()
    await page.getByLabel('Title', {exact: true}).fill('A letter about a slave')
    await page.getByLabel('Subtitle').fill('Paul to Philemon')
    await click_button(page, 'Done')

    await expect.poll(async () => {
        const [item] = await stored_content(design_id)
        return [item!['title'], item!['title_subtitle']]
    }).toEqual(['A letter about a slave', 'Paul to Philemon'])
})


test('adding a page of text', async ({page}) => {
    const design_id = await open_editor(page)

    await click_button(page.locator('.add'), 'Text')
    await expect(page.getByText('Edit text')).toBeVisible()
    // The rich-text editor is a lazily loaded component, so wait for it to mount
    const prose = page.locator('.ProseMirror')
    await prose.click()
    await page.keyboard.type('Read this slowly, and more than once.')
    await click_button(page, 'Done')

    // Listed by its opening words, since it wasn't given a label
    await expect(content_rows(page)).toHaveCount(2)
    await expect(content_rows(page).nth(1)).toContainText('Read this slowly')
    await expect.poll(async () => JSON.stringify((await stored_content(design_id))[1]))
        .toContain('Read this slowly, and more than once.')
})


test('a title page and a copyright page', async ({page}) => {
    const design_id = await open_editor(page)

    await click_button(page.locator('.add'), 'Title page')
    await page.getByLabel('Title', {exact: true}).fill('Philemon')
    await page.getByLabel('Subtitle').fill('A short letter')
    await click_button(page, 'Done')

    // Only one copyright page is ever needed, so the button is spent once used
    const copyright = page.locator('.add').getByRole('button', {name: 'Copyright'})
    await copyright.click()
    await expect(copyright).toBeDisabled()

    await expect.poll(async () => (await stored_content(design_id)).map(item => item['type']))
        .toEqual(['passage', 'title', 'custom'])
    const [, title, notice] = await stored_content(design_id)
    expect(title!['title']).toBe('Philemon')
    expect(title!['title_subtitle']).toBe('A short letter')
    // The copyright page is filled in at compile time from the translations used
    expect(JSON.stringify(notice!['doc'])).toContain('AUTO-COPYRIGHT')
})


test('removing an item', async ({page}) => {
    const design_id = await open_editor(page)
    await click_button(page.locator('.add'), 'Copyright')
    await expect(content_rows(page)).toHaveCount(2)
    await expect.poll(async () => (await stored_content(design_id)).length).toBe(2)

    // The close button at the end of the passage's row
    await content_rows(page).first().getByRole('button').last().click()
    await expect(content_rows(page)).toHaveCount(1)
    await expect.poll(async () => (await stored_content(design_id)).map(item => item['type']))
        .toEqual(['custom'])
})


test('options are saved to the design', async ({page}) => {
    const design_id = await open_editor(page)

    // A checkbox, a segmented toggle, and a slider (driven from the keyboard, as its thumb is)
    await page.getByLabel('Verse numbers').uncheck()
    await page.getByRole('group', {name: 'Columns'}).getByRole('button', {name: 'Two'}).click()
    const font_size = page.locator('.v-slider').filter({hasText: 'Font size'})
        .getByRole('slider')
    await font_size.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')

    await expect.poll(() => stored_option(design_id, 'show_verses')).toBe(false)
    await expect.poll(() => stored_option(design_id, 'columns')).toBe(true)
    // The slider is continuous, so this is "bigger than the default 10", not a whole size
    await expect.poll(async () => await stored_option(design_id, 'font_size') as number)
        .toBeGreaterThan(10)

    // And they're what the editor shows when the design is opened again
    await page.reload()
    await expect(page.getByLabel('Verse numbers')).not.toBeChecked({timeout: 60_000})
    await expect(page.getByRole('group', {name: 'Columns'})
        .getByRole('button', {name: 'Two'})).toHaveClass(/v-btn--active/)
})


test('naming the design', async ({page}) => {
    const design_id = await open_editor(page)

    await page.getByLabel('Name').fill('For the prison ministry')
    await expect.poll(async () => (await design_data(design_id))['name'])
        .toBe('For the prison ministry')
    await expect(page.locator('.navbar').getByText('For the prison ministry')).toBeVisible()
})


test('the preview renders the design', async ({page}) => {
    // The one in-browser compile here: Philemon in the WASM engine, shown in the sidebar
    test.setTimeout(3 * 60 * 1000)
    await open_editor(page)

    // Each page an image: with no cover, page 1 on its own first, then facing-page spreads, and
    // no note at either end since the whole book fits
    const pages = page.locator('.preview .frame img.page')
    await expect(pages.first()).toBeVisible({timeout: 2 * 60 * 1000})
    expect(await pages.first().evaluate(img => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
    await expect(page.locator('.preview .pages > :first-child')).toHaveClass(/page/)
    await expect(page.locator('.preview .strip')).toHaveCount(0)
    await expect(page.getByText('Couldn\'t generate preview')).toBeHidden()

    // An edit recompiles it into a new document
    const first = await pages.first().getAttribute('src')
    await page.getByLabel('Verse numbers').uncheck()
    await expect.poll(() => pages.first().getAttribute('src'), {timeout: 60_000})
        .not.toBe(first)
})


test('a desktop switched to the server previews there, on request', async ({page}) => {
    // A desktop whose browser couldn't cope (see compile_mode.ts): its preview is made on the
    // server, which is stubbed here (no journey compiles on the server)
    await page.addInitScript(() => {
        localStorage.setItem('compile_on_server', '1')
    })
    const uid = await boot(page)
    const previews = await stub_server_preview(page, uid)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)

    // One preview as the pane opens, shown as the browser's would be
    const pages = page.locator('.preview .frame img.page')
    await expect(pages.first()).toBeVisible({timeout: 60_000})
    expect(previews).toEqual(['desktop'])
    const refresh = page.locator('.preview .toolbar').getByRole('button', {name: 'Refresh'})
    await expect(refresh).not.toHaveClass(/v-btn--variant-elevated/)

    // An edit doesn't ask for another, since each one costs the server, but Refresh stands out
    // as the preview is now out of date, and asks for one
    const first = await pages.first().getAttribute('src')
    await page.getByLabel('Verse numbers').uncheck()
    await expect.poll(async () => (await design_data(design_id))['blueprint'])
        .toMatchObject({show_verses: false})
    await expect(refresh).toHaveClass(/v-btn--variant-elevated/)
    await page.waitForTimeout(2000)
    expect(previews).toEqual(['desktop'])
    await refresh.click()
    await expect.poll(() => pages.first().getAttribute('src')).not.toBe(first)
    expect(previews).toEqual(['desktop', 'desktop'])
    await expect(refresh).not.toHaveClass(/v-btn--variant-elevated/)
})


test('zooming the preview, to print size and back', async ({page}) => {
    // Previewed on the server (stubbed) so as not to wait on a compile: three 100×140pt pages,
    // shown as page 1 alone and then a spread, which fills the pane's width
    await page.addInitScript(() => {
        localStorage.setItem('compile_on_server', '1')
    })
    const uid = await boot(page)
    await stub_server_preview(page, uid, [PREVIEW_SVG_PAGE, PREVIEW_SVG_PAGE, PREVIEW_SVG_PAGE])
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)
    const first = page.locator('.preview .frame img.page').first()
    await expect(first).toBeVisible({timeout: 60_000})
    const width = () => first.evaluate(img => img.getBoundingClientRect().width)
    const fitted = await width()

    // Ctrl+wheel over the pages zooms in on them
    await first.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect.poll(width).toBeGreaterThan(fitted * 1.1)

    // The toolbar's zoom shows the paper widths while open, and 1× is print size: a point is
    // 4/3 of a CSS pixel, so a 100pt page is 133px wide and A4's line 794px
    await page.locator('.preview .toolbar').getByRole('button', {name: /^Zoom:/}).click()
    const scale = page.locator('.paper_scale')
    await expect(scale).toContainText('A4 width (21 cm)')
    await click_button(page.locator('.zoom_menu'), '1×')
    await expect.poll(width).toBeCloseTo(100 * 4 / 3, 0)
    expect(await scale.locator('.paper_line').first().evaluate(line =>
        line.getBoundingClientRect().width)).toBeCloseTo(793.7, 0)

    // Fit to width undoes it all, and closing the menu takes the paper widths with it
    await page.locator('.zoom_menu').getByRole('button', {name: 'Fit to width'}).click()
    await expect.poll(width).toBeCloseTo(fitted, 0)
    await page.keyboard.press('Escape')
    await expect(scale).toBeHidden()
})


test('either of two translations can be removed, and another added', async ({page}) => {
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    const design = await design_data(design_id)
    await admin_db.doc(`designs/${design_id}`).update({blueprint: {
        ...design['blueprint'] as object, bibles: ['eng_bsb', 'eng_web']}})
    await page.goto(`/designs/${design_id}`)
    const translations = page.locator('h2:has-text("Bible translations") + .v-list .v-list-item')
    await expect(translations.last()).toContainText('World English Bible', {timeout: 60_000})

    // Removing the first leaves the second as the only one, which can't itself be removed
    await translations.first().getByRole('button').click()
    await expect.poll(() => stored_option(design_id, 'bibles'), {timeout: 30_000})
        .toEqual(['eng_web'])
    await expect(translations.first()).toContainText('World English Bible')
    await expect(translations.first().getByRole('button')).toHaveCount(0)
    await expect(translations.last()).toContainText('Add additional translation')

    // Opening the additional slot and cancelling adds nothing
    await translations.last().click()
    await click_button(page, 'Cancel')
    await expect(translations.last()).toContainText('Add additional translation')
    expect(await stored_option(design_id, 'bibles')).toEqual(['eng_web'])

    // Choosing the translation already there wouldn't make a pairing, so nothing changes
    const picker = page.locator('.v-card')
        .filter({has: page.getByRole('button', {name: 'Languages', exact: true})})
    await translations.last().click()
    await picker.locator('.v-list-item').filter({hasText: 'World English Bible'}).first().click()
    await expect(picker).toBeHidden()
    await expect(translations.last()).toContainText('Add additional translation')
    expect(await stored_option(design_id, 'bibles')).toEqual(['eng_web'])

    // Choosing another adds it
    await translations.last().click()
    await picker.locator('.v-list-item').filter({hasText: 'Berean Standard Bible'}).first().click()
    await expect.poll(() => stored_option(design_id, 'bibles'), {timeout: 30_000})
        .toEqual(['eng_web', 'eng_bsb'])
})


test('a preview zoomed past the pane pans by dragging, and a Mac\'s pinch zooms it',
        async ({page}) => {
    // Previewed on the server (stubbed), as in the zoom journey above
    await page.addInitScript(() => {
        localStorage.setItem('compile_on_server', '1')
    })
    const uid = await boot(page)
    await stub_server_preview(page, uid, [PREVIEW_SVG_PAGE, PREVIEW_SVG_PAGE, PREVIEW_SVG_PAGE])
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await page.goto(`/designs/${design_id}`)
    const first = page.locator('.preview .frame img.page').first()
    await expect(first).toBeVisible({timeout: 60_000})
    const viewport = page.locator('.preview .viewport')
    const width = () => first.evaluate(img => img.getBoundingClientRect().width)
    const fitted = await width()

    // Safari's own gesture events (a Mac trackpad's pinch) zoom the preview, not the page
    await viewport.evaluate(element => {
        const gesture = (type:string, scale:number) => Object.assign(
            new Event(type, {cancelable: true}), {scale, clientX: 300, clientY: 300})
        element.dispatchEvent(gesture('gesturestart', 1))
        element.dispatchEvent(gesture('gesturechange', 3))
    })
    // (as far as the zoom goes, which stops short of three times this pane's fit)
    await expect.poll(width).toBeGreaterThan(fitted * 1.1)
    await expect(viewport).toHaveClass(/pannable/)

    // Wider than the pane now, so a mouse drags the pages around
    const scroll = () => viewport.evaluate(element => [element.scrollLeft, element.scrollTop])
    const [left, top] = await scroll()
    const box = (await viewport.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect(viewport).toHaveClass(/panning/)
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 80, {steps: 5})
    await page.mouse.up()
    await expect(viewport).not.toHaveClass(/panning/)
    const [panned_left, panned_top] = await scroll()
    expect(panned_left).toBeGreaterThan(left!)
    expect(panned_top).toBeGreaterThan(top!)
})


test('study notes ask for a copyright page until there is one', async ({page}) => {
    // Tyndale's notes can't be printed without attribution
    const uid = await boot(page)
    const design_id = await seed_own_design(uid, {simple_mode: false})
    const design = await design_data(design_id)
    await admin_db.doc(`designs/${design_id}`).update({blueprint: {
        ...design['blueprint'] as object, notes: 'eng_tyndale'}})
    await page.goto(`/designs/${design_id}`)
    const warning = page.getByText('A copyright statement is required for one or more'
        + ' translations.')
    await expect(warning).toBeVisible({timeout: 60_000})

    // A copyright page satisfies it
    await page.locator('.add').getByRole('button', {name: 'Copyright'}).click()
    await expect(warning).toBeHidden()
})
