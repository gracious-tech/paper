
// The cover, which is designed in the bookcover widget embedded from cover-widget.paper.bible
// (another repo, production build — see stack.ts). The app and the widget only meet through
// their postMessage protocol (InitMessage in, 'ready'/'finished'/'cancelled' out), so this is
// the one place a change on either side of it would show

import {createHash} from 'node:crypto'

import {test, expect, boot, click_button, confirm_dialog, design_data} from './fixtures'
import {seed_own_design, admin_bucket, admin_db} from './helpers/admin'

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
    // Once the preview pane has rendered it, the cover options show that render, which opens the
    // editor when clicked
    await expect(page.locator('button.thumb img.render')).toBeVisible({timeout: 60_000})

    // Removing asks first, and discards the config rather than disabling it
    await click_button(page, 'Remove cover')
    await expect(confirm_dialog(page).getByText('Remove this cover design?')).toBeVisible()
    await click_button(confirm_dialog(page), 'OK')
    await expect.poll(() => stored_cover(design_id), {timeout: 30_000}).toBe(null)
})


test('the widget previews the copyright statement in place of the blurb\'s marker',
        async ({page}) => {
    // Keep the init message where the widget receives it (init scripts run in every frame)
    await page.addInitScript(() => {
        window.addEventListener('message', event => {
            const data = event.data as {type?:string}|null
            if (data?.type === 'init'){
                (window as unknown as {init_message:unknown}).init_message = data
            }
        })
    })
    const design_id = await open_editor(page)

    await click_button(page, 'Add cover')
    await expect(page.locator('.cover_editor').getByRole('button'))
        .toBeHidden({timeout: 2 * 60 * 1000})

    // The widget is handed the statement for its preview. Had it failed to compile there, the
    // widget would have relayed an error, which fails the journey (see e2e/fixtures.ts)
    const widget_frame = page.frames().find(frame => frame.url().includes('cover-widget'))
    const substitutions = await widget_frame!.evaluate(() =>
        (window as unknown as {init_message:{typst_substitutions?:Record<string, string>}})
            .init_message.typst_substitutions)
    expect(substitutions!['AUTO-COPYRIGHT']).toContain('Resources used:')
    // With the link + QR code back to the design, as the app's own previews show it
    expect(substitutions!['AUTO-COPYRIGHT'])
        .toContain(`#link("https://paper.bible/designs/${design_id}")`)

    // While the cover itself keeps the marker, for each render to resolve afresh
    await page.frameLocator('.cover_editor iframe').getByRole('button', {name: /finish/i})
        .click()
    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})
    await expect.poll(async () => {
        const cover = await stored_cover(design_id) as {form:{blurb?:unknown}}|null
        return JSON.stringify(cover?.form.blurb ?? null)
    }, {timeout: 30_000}).toContain('AUTO-COPYRIGHT')
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


// Open the full editor on a seeded design with an uploaded font, listed under each of `ids`.
// Its bytes are stored under `basename` (their own hash unless given), as the entries name
async function open_editor_with_font(page:Page, ids:string[], basename?:string)
        :Promise<{design_id:string, entry:Record<string, unknown>}>{
    const uid = await boot(page)
    const response = await fetch(
        'https://assets.paper.bible/fonts/_noto/Noto%20Sans%20Adlam/NotoSansAdlam-Regular.otf')
    const bytes = Buffer.from(await response.arrayBuffer())
    const design_id = await seed_own_design(uid, {simple_mode: false})
    basename ??= createHash('sha256').update(bytes).digest('hex')
    const path = `design_assets/${design_id}/${basename}.bin`
    await admin_bucket.file(path).save(bytes, {contentType: 'font/otf'})
    const entry = {family: 'Noto Sans Adlam', style: 'sans', files: [path]}
    await admin_db.doc(`designs/${design_id}`)
        .update({fonts: Object.fromEntries(ids.map(id => [id, entry]))})

    await page.goto(`/designs/${design_id}`)
    await expect(page.getByText('This design does not currently include a cover.'))
        .toBeVisible({timeout: 60_000})
    return {design_id, entry}
}


test('saving the cover keeps one entry per uploaded font', async ({page}) => {
    // The widget hands back every font it was offered, so a font the design already has must
    // come back as that same font. A design that once listed one family several times (all
    // naming the same files) is left with a single entry, and its files aren't uploaded again
    const {design_id, entry} = await open_editor_with_font(page, ['font_a', 'font_b', 'font_c'])
    await edit_then_finish(page)
    await page.frameLocator('.cover_editor iframe')
        .getByRole('button', {name: 'Save', exact: true}).click()
    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})

    await expect.poll(async () => {
        const fonts = (await design_data(design_id))['fonts'] as Record<string, unknown>
        return Object.values(fonts)
    }, {timeout: 30_000}).toEqual([entry])
})


test('a slow save shows that the cover is saving', async ({page}) => {
    // A font stored under a path that isn't its hash is uploaded again at Save, and holding
    // that upload open stands in for a slow connection
    await open_editor_with_font(page, ['font_a'], '0'.repeat(64))
    let release = ():void => undefined
    const held = new Promise<void>(resolve => {
        release = resolve
    })
    await page.route(/\/v0\/b\/[^/]+\/o\?/, async route => {
        if (route.request().method() === 'POST'){
            await held
        }
        await route.continue()
    })

    await edit_then_finish(page)
    await page.frameLocator('.cover_editor iframe')
        .getByRole('button', {name: 'Save', exact: true}).click()
    const saving = page.locator('.cover_editor').getByRole('status')
    await expect(saving).toHaveText('Saving cover...')
    release()
    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})
})


// --- The embed protocol's backgrounds and errors ---------------------------------------------


// A 1×1 PNG, enough for the widget to take as an uploaded background
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDw'
    + 'AEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// A background bookcover ships, as the widget names it
const BUILTIN_BG = 'beach.jpg'

// Upload TINY_PNG as one of a design's own cover backgrounds, returning its stored identity
async function upload_bg(design_id:string):Promise<{kind:'custom', path:string, hash:string}>{
    const hash = createHash('sha256').update(TINY_PNG).digest('hex')
    const path = `design_assets/${design_id}/${hash}.png`
    await admin_bucket.file(path).save(TINY_PNG, {contentType: 'image/png'})
    return {kind: 'custom', path, hash}
}


// What the app posted into the widget so far, kept where the widget receives it (init scripts
// run in every frame), with any File reduced to its size so it survives the trip back out
async function keep_host_messages(page:Page):Promise<void>{
    await page.addInitScript(() => {
        const kept:unknown[] = []
        ;(window as unknown as {host_messages:unknown[]}).host_messages = kept
        window.addEventListener('message', event => {
            const data = event.data as Record<string, unknown>|null
            if (data && typeof data['type'] === 'string'){
                kept.push(Object.fromEntries(Object.entries(data).map(([key, value]) =>
                    [key, value instanceof File ? {file_size: value.size} : value])))
            }
        })
    })
}


// The widget's frame, and the messages it has had from the app
function widget(page:Page){
    const frame = page.frames().find(item => item.url().includes('cover-widget'))!
    return {
        frame,
        received: () => frame.evaluate(() =>
            (window as unknown as {host_messages:Record<string, unknown>[]}).host_messages),
        // Post as the widget would, from its own window to the app
        post: (message:Record<string, unknown>) => frame.evaluate(data => {
            parent.postMessage(data, '*')
        }, message),
    }
}


// Open the cover editor on a design (its cover's picture, or "Add cover"), once it has loaded
async function open_widget(page:Page, design_id:string):Promise<void>{
    await page.goto(`/designs/${design_id}`)
    const thumb = page.locator('button.thumb')
    const add = page.getByRole('button', {name: 'Add cover', exact: true})
    await expect(thumb.or(add)).toBeVisible({timeout: 60_000})
    await (await thumb.isVisible() ? thumb : add).click()
    await expect(page.locator('.cover_editor').getByRole('button'))
        .toBeHidden({timeout: 2 * 60 * 1000})
}


// Give a design the widget's default cover (added and finished there, so its form is one the
// renderer takes), then swap in `bg_image` behind the app's back, as another device would
async function seed_cover(page:Page, design_id:string, bg_image:Record<string, unknown>)
        :Promise<void>{
    await open_widget(page, design_id)
    await finish_unchanged(page)
    await expect.poll(() => stored_cover(design_id), {timeout: 30_000}).not.toBe(null)
    await admin_db.doc(`designs/${design_id}`).update({'blueprint.cover.bg_image': bg_image})
}


// Press the widget's Finish, with nothing changed, so it saves outright
async function finish_unchanged(page:Page):Promise<void>{
    await page.frameLocator('.cover_editor iframe').getByRole('button', {name: /finish/i})
        .click()
    await expect(page.locator('.cover_editor')).toBeHidden({timeout: 60_000})
}


test('a builtin background crosses by its id both ways, never as bytes', async ({page}) => {
    await keep_host_messages(page)
    const uid = await boot(page)
    const builtin = {kind: 'builtin', id: BUILTIN_BG}
    const design_id = await seed_own_design(uid, {simple_mode: false})
    await seed_cover(page, design_id, builtin)

    await open_widget(page, design_id)
    const init = (await widget(page).received()).filter(message => message['type'] === 'init')
        .at(-1)!
    expect([init['bg_image_builtin'], init['bg_image']]).toEqual([BUILTIN_BG, null])

    await finish_unchanged(page)
    await expect.poll(async () =>
        ((await stored_cover(design_id)) as {bg_image:unknown}).bg_image, {timeout: 30_000})
        .toEqual(builtin)
})


test('an uploaded background goes over as its bytes, and back without a new upload',
    async ({page}) => {
        await keep_host_messages(page)
        const uid = await boot(page)
        const design_id = await seed_own_design(uid, {simple_mode: false})
        const bg = await upload_bg(design_id)
        await seed_cover(page, design_id, bg)

        await open_widget(page, design_id)
        const init = (await widget(page).received()).filter(message => message['type'] === 'init')
            .at(-1)!
        expect([init['bg_image'], init['bg_image_builtin']])
            .toEqual([{file_size: TINY_PNG.length}, null])

        // The same bytes back mean the same background, so nothing new is stored
        await finish_unchanged(page)
        await page.waitForTimeout(2000)
        expect(((await stored_cover(design_id)) as {bg_image:unknown}).bg_image).toEqual(bg)
        const [files] = await admin_bucket.getFiles({prefix: `design_assets/${design_id}/`})
        expect(files.map(file => file.name)).toEqual([bg.path])
    })


test('backgrounds from other designs are offered, and only those are handed over',
    async ({page}) => {
        await keep_host_messages(page)
        const uid = await boot(page)
        // Another of the user's designs has a cover with a photo of its own
        const other_id = await seed_own_design(uid, {name: 'The other book', simple_mode: false})
        const bg = await upload_bg(other_id)
        await seed_cover(page, other_id, bg)
        const design_id = await seed_own_design(uid, {simple_mode: false})

        await open_widget(page, design_id)
        const {received, post} = widget(page)
        const init = (await received()).find(message => message['type'] === 'init')!
        expect(init['bg_suggestions']).toEqual([
            {id: bg.path, url: expect.stringContaining(encodeURIComponent(bg.path)),
                label: 'The other book'}])

        // Picking it fetches its bytes; an id the app never offered gets nothing, whatever
        // Storage path it names
        const resolved = async (id:string) => {
            await post({type: 'bg_suggestion_selected', id})
            await expect.poll(async () => (await received()).some(message =>
                message['type'] === 'bg_suggestion_resolved' && message['id'] === id)).toBe(true)
            return (await received()).find(message =>
                message['type'] === 'bg_suggestion_resolved' && message['id'] === id)!['bg_image']
        }
        expect(await resolved(bg.path)).toEqual({file_size: TINY_PNG.length})
        expect(await resolved(`design_assets/${other_id}/elsewhere.png`)).toBe(null)
    })


test.describe('what the widget relays that it shouldn\'t have', () => {
    test.use({expected_reports:
        /^Cover widget: TypeError: boom|Unknown builtin background from cover widget/})

    test('its errors are reported as its own, with their stack labelled', async ({page,
            error_reports}) => {
        const design_id = await seed_own_design(await boot(page), {simple_mode: false})
        await open_widget(page, design_id)
        await widget(page).post({type: 'error', build: 'abc123',
            message: 'TypeError: boom\n\nat render (widget.js:1:2)'})
        await expect.poll(() => error_reports.find(report =>
            report.message.startsWith('Cover widget:'))).toMatchObject({
            message: 'Cover widget: TypeError: boom\n\nWidget stack:\nat render (widget.js:1:2)',
            context: {source: 'cover_widget', widget_build: 'abc123'}})
    })

    test('a background it names that bookcover doesn\'t ship keeps the existing one',
        async ({page}) => {
            await keep_host_messages(page)
            const uid = await boot(page)
            const builtin = {kind: 'builtin', id: BUILTIN_BG}
            const design_id = await seed_own_design(uid, {simple_mode: false})
            await seed_cover(page, design_id, builtin)
            await open_widget(page, design_id)
            const init = (await widget(page).received())
                .filter(message => message['type'] === 'init').at(-1)!

            await widget(page).post({type: 'finished', data: init['preset'], bg_image: null,
                bg_image_builtin: 'not-a-background.jpg', custom_fonts: []})
            await expect(page.locator('.cover_editor')).toBeHidden({timeout: 30_000})
            await page.waitForTimeout(2000)
            expect(((await stored_cover(design_id)) as {bg_image:unknown}).bg_image)
                .toEqual(builtin)
        })
})
