// Passage images with a painted or torn border. The border is a canvas mask the browser applies
// to the user's own image (image_frame.ts), so these are the journeys that run it: the masked
// copy is made for the preview, stored beside the design as a regenerable variant, and baked
// into a version at "Build it" — while the image the user supplied is never touched, so the
// mask is always applied to the original rather than stacking on an already-masked copy

import {createHash} from 'node:crypto'

import {test, expect, boot, click_button, design_data, build_version} from './fixtures'
import {admin_bucket, admin_db, seed_own_design} from './helpers/admin'
import {storage_url} from './stack'

import type {Page} from '@playwright/test'


// A photo-sized solid red PNG, made by the page's own canvas (the same encoder the app uses)
async function red_png(page:Page):Promise<Buffer>{
    const bytes = await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(400, 300)
        const context = canvas.getContext('2d')!
        context.fillStyle = '#ff0000'
        context.fillRect(0, 0, 400, 300)
        const blob = await canvas.convertToBlob({type: 'image/png'})
        return [...new Uint8Array(await blob.arrayBuffer())]
    })
    return Buffer.from(bytes)
}


// The alpha of a PNG's corner and centre pixels, decoded by the page
async function corner_and_centre_alpha(page:Page, png:Buffer):Promise<[number, number]>{
    return await page.evaluate(async (base64:string) => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        const alpha = (x:number, y:number) => context.getImageData(x, y, 1, 1).data[3]!
        return [alpha(1, 1), alpha(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2))]
    }, png.toString('base64')) as [number, number]
}


// Wait for a Storage object to exist, then return its bytes
async function stored_file(path:string):Promise<Buffer>{
    const file = admin_bucket.file(path)
    await expect.poll(async () => (await file.exists())[0],
        {message: `${path} should be stored`, timeout: 2 * 60 * 1000}).toBe(true)
    return (await file.download())[0]
}


test('a painted, then torn, border is masked from the original and built in', async ({page}) => {
    // Two preview compiles and a build in the WASM engine
    test.setTimeout(5 * 60 * 1000)
    const uid = await boot(page)

    // A design whose one passage has an uploaded photo, shown with a painted border
    const original = await red_png(page)
    const hash = createHash('sha256').update(original).digest('hex')
    const design_id = await seed_own_design(uid, {simple_mode: false})
    const original_path = `design_assets/${design_id}/${hash}.png`
    await admin_bucket.file(original_path).save(original, {contentType: 'image/png'})
    const design = await design_data(design_id)
    const items = design['content_items'] as Record<string, Record<string, unknown>>
    await admin_db.doc(`designs/${design_id}`).update({
        'blueprint.image_style': 'painted',
        'content_items.passage_1': {...items['passage_1'], image: {source: 'upload',
            url: storage_url(original_path), path: original_path, hash, original: null}},
    })

    // The preview needs the masked copy, so opening the design makes one: the first image of the
    // document takes variant 0, keyed by the original's hash
    await page.goto(`/designs/${design_id}`)
    const painted = await stored_file(`design_cache/${design_id}/painted_v0_${hash}.png`)
    await expect(page.locator('.preview .frame img.page').first())
        .toBeVisible({timeout: 2 * 60 * 1000})

    // The mask erased the border and left the middle of the photo as it was
    const [painted_corner, painted_centre] = await corner_and_centre_alpha(page, painted)
    expect(painted_corner).toBe(0)
    expect(painted_centre).toBe(255)

    // Switching to torn masks the original again, not the painted copy
    await page.getByRole('button', {name: 'Advanced options', exact: true}).click()
    await click_button(page, 'Torn')
    const torn = await stored_file(`design_cache/${design_id}/torn_v0_${hash}.png`)
    expect(torn.equals(painted)).toBe(false)
    const [torn_corner, torn_centre] = await corner_and_centre_alpha(page, torn)
    expect(torn_corner).toBe(0)
    expect(torn_centre).toBe(255)
    await click_button(page, 'Done')

    // The design itself still names only what the user supplied, which is still as supplied
    await expect.poll(async () => ((await design_data(design_id))['blueprint'] as
        Record<string, unknown>)['image_style']).toBe('torn')
    const stored_items = (await design_data(design_id))['content_items'] as
        Record<string, {image:{path:string}}>
    expect(stored_items['passage_1']!.image.path).toBe(original_path)
    expect((await admin_bucket.file(original_path).download())[0].equals(original)).toBe(true)

    // A build bakes the torn copy into the version, carrying the original beside it so the
    // version can be turned back into a design without the mask baked in
    const version = await build_version(page, design_id)
    expect(version.data['status']).toBe('available')
    const blueprint = version.data['blueprint'] as {content:{image:{path:string,
        original:{path:string}}}[]}
    expect(blueprint.content[0]!.image.path).toBe(`version_assets/${design_id}/torn_v0_${hash}.png`)
    expect(blueprint.content[0]!.image.original.path)
        .toBe(`version_assets/${design_id}/${hash}.png`)
})
