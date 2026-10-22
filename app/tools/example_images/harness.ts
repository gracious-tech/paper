
// The browser half of .bin/gen_example_images (see app/tools/gen_example_images.ts, which loads
// this module into a page on the app's own Vite dev server). It builds each example exactly as
// the app does when one is clicked, renders its cover through the app's own cover worker, and
// photographs it in 3D the way the bookcover widget's 3D preview shows a cover by default

import {Book3DRenderer} from 'bookcover-3d-web'
import {resolve_dimensions, RENDER_VERSION} from 'bookcover-core'
import {cover_form_for_render} from 'paper-bible-typst'

import {bible_content, content} from '@/services/content'
import {load_locale, translate} from '@/services/i18n'
import {build_example_blueprint} from '@/services/examples'
import {EXAMPLE_DESIGNS, example_label} from '@/services/example_designs'
import {render_cover_panels} from '@/services/cover'
import {clean_blueprint} from '@/services/blueprints'

import type {CoverType} from 'bookcover-3d-web'
import type {DimensionInputs} from 'bookcover-core'
import type {Blueprint} from '@/services/types'


// Bump to re-render every picture after changing how they're made (camera, size, framing)
const GENERATOR_VERSION = 1

// The bookcover widget's default 3D view (Preview3D.vue in the bookcover repo): its starting
// camera angles, and the BASE_ZOOM its 3D view frames the book with
const AZIMUTH = -30
const ELEVATION = 20
const ZOOM = 0.75

// The 3D render's height in pixels, before being scaled down into the output picture
const RENDER_HEIGHT = 2400

// The output picture: the book fitted within a margin, centred on a transparent canvas
const OUT_WIDTH = 720
const OUT_HEIGHT = 1080
const MARGIN = 54
const WEBP_QUALITY = 0.85


// What the generator learns about one example before deciding whether to render it
export interface ExampleInfo {
    id:string
    // Everything the picture depends on, hashed — equal hashes mean identical pictures
    hash:string
    title:string
    subtitle:string
}


// Load the Bible collection the examples are built from (once per page)
const ready = (async () => {
    await bible_content.init()
    content.collection = bible_content.collection
    content.translations = content.collection.get_resources({object: true})
    content.languages = content.collection.get_languages({object: true})
})()


// Build an example's blueprint in a locale, as create_example_design() does when it's clicked,
// cleaned as create_design() stores it (minus the personal message page, which is interior
// content the cover never shows)
function example_blueprint(id:string, locale:string):Blueprint{
    const example = EXAMPLE_DESIGNS.find(item => item.id === id)!
    const {title, subtitle} = example_label(id, translate)
    const bible = content.collection.get_preferred_resource([locale]).id
    return clean_blueprint(build_example_blueprint(example, title, subtitle, null, bible))
}


// The 3D model's binding and the book's depth, worked out the way the bookcover widget does
// (PreviewPane.vue): a custom-sized book without a spine is stapled, and a binding with no spine
// panel is given the book's thickness instead
function binding_for(blueprint:Blueprint, pages:number, has_spine:boolean)
        :{cover_type:CoverType, depth_mm:number|undefined}{
    const form = cover_form_for_render(blueprint.cover!, blueprint, pages)
    const inputs = (form['size_mode'] === 'custom' ? {...form, size_id: undefined} : form)
    const dims = resolve_dimensions(inputs as unknown as DimensionInputs)
    const cover_type = form['service_id'] === 'custom' && dims.cover_spine.toNumber() === 0
        ? 'paperback_stitch' : form['binding_type'] as CoverType
    return {cover_type, depth_mm: has_spine ? undefined : dims.depth.toNumber()}
}


// Hex SHA-256 of some text
async function sha256(text:string):Promise<string>{
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}


// Describe every example in a locale, so the generator can tell which pictures changed
export async function describe_examples(locale:string):Promise<ExampleInfo[]>{
    await ready
    await load_locale(locale)
    const infos:ExampleInfo[] = []
    for (const example of EXAMPLE_DESIGNS){
        const blueprint = example_blueprint(example.id, locale)
        const cover = blueprint.cover!
        const form = cover_form_for_render(cover, blueprint, example.pages)
        const inputs = {form, bg_image: cover.bg_image, RENDER_VERSION, GENERATOR_VERSION}
        infos.push({
            id: example.id,
            hash: (await sha256(JSON.stringify(inputs))).slice(0, 16),
            title: String(form['title1']),
            subtitle: String(form['subtitle']),
        })
    }
    return infos
}


// Render one example's picture in a locale, returned as base64 webp bytes
export async function render_example(id:string, locale:string):Promise<string>{
    await ready
    await load_locale(locale)
    const example = EXAMPLE_DESIGNS.find(item => item.id === id)!
    const blueprint = example_blueprint(id, locale)

    // Photograph the cover as the widget's 3D view first shows it, with the canvas shaped to
    // the book's projected outline like the widget's is
    const panels = await render_cover_panels(blueprint, example.pages)
    const {cover_type, depth_mm} = binding_for(blueprint, example.pages, !!panels.spine)
    const renderer = new Book3DRenderer()
    try {
        await renderer.load(panels, cover_type, depth_mm)
        const aspect = renderer.get_projected_aspect()
        renderer.resize(Math.round(RENDER_HEIGHT * aspect), RENDER_HEIGHT)
        renderer.render(AZIMUTH, ELEVATION, ZOOM)
        const bitmap = await renderer.snapshot()
        const blob = await frame_picture(bitmap)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (const byte of bytes){
            binary += String.fromCharCode(byte)
        }
        return btoa(binary)
    } finally {
        renderer.destroy()
    }
}


// Crop a render to the book itself, then fit it within the output picture's margin
async function frame_picture(bitmap:ImageBitmap):Promise<Blob>{
    const source = new OffscreenCanvas(bitmap.width, bitmap.height)
    const source_ctx = source.getContext('2d')!
    source_ctx.drawImage(bitmap, 0, 0)
    const box = opaque_bounds(source_ctx.getImageData(0, 0, bitmap.width, bitmap.height))

    // Scale down in halving steps, since a single large reduction aliases the cover's text
    const scale = Math.min((OUT_HEIGHT - MARGIN * 2) / box.height,
        (OUT_WIDTH - MARGIN * 2) / box.width)
    const width = box.width * scale
    const height = box.height * scale
    let step:OffscreenCanvas = source
    let sx = box.x, sy = box.y, sw = box.width, sh = box.height
    while (width < sw / 2){
        const half = new OffscreenCanvas(Math.ceil(sw / 2), Math.ceil(sh / 2))
        const half_ctx = half.getContext('2d')!
        half_ctx.imageSmoothingQuality = 'high'
        half_ctx.drawImage(step, sx, sy, sw, sh, 0, 0, half.width, half.height)
        step = half
        sx = 0
        sy = 0
        sw = half.width
        sh = half.height
    }

    // Centre the book on the output canvas
    const out = new OffscreenCanvas(OUT_WIDTH, OUT_HEIGHT)
    const out_ctx = out.getContext('2d')!
    out_ctx.imageSmoothingQuality = 'high'
    out_ctx.drawImage(step, sx, sy, sw, sh,
        (OUT_WIDTH - width) / 2, (OUT_HEIGHT - height) / 2, width, height)
    return out.convertToBlob({type: 'image/webp', quality: WEBP_QUALITY})
}


// The smallest rectangle holding every pixel that isn't fully transparent
function opaque_bounds(image:ImageData):{x:number, y:number, width:number, height:number}{
    let min_x = image.width, min_y = image.height, max_x = -1, max_y = -1
    for (let y = 0; y < image.height; y++){
        for (let x = 0; x < image.width; x++){
            if (image.data[(y * image.width + x) * 4 + 3]! > 0){
                min_x = Math.min(min_x, x)
                max_x = Math.max(max_x, x)
                min_y = Math.min(min_y, y)
                max_y = Math.max(max_y, y)
            }
        }
    }
    if (max_x < 0){
        throw new Error('The 3D render came out empty')
    }
    return {x: min_x, y: min_y, width: max_x - min_x + 1, height: max_y - min_y + 1}
}
