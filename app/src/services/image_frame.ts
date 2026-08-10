
// Decorative painted/torn image borders via canvas masking — ported from gracious-tech/bookcover's
// generator/src/frame.ts (same technique used for book cover photos). The frame PNG is opaque
// (white) at its border and transparent in the centre; drawing it with 'destination-out' erases
// the photo pixels beneath it, leaving an irregular transparent edge. Unlike bookcover's cover use
// (a fixed-size canvas with an engineered solid background), no background is filled here — the
// photo is masked at its own pixel size with a fully transparent border, so whatever a page's
// actual background is (plain white, a custom color, a decorative backdrop) shows through
// untouched once Typst places the resulting PNG

import {ASSETS_PREFIX} from '@/services/typst'

import type {ImageStyle} from '@/services/types'


// Frame PNGs published by the bookcover repo alongside its other generator assets
const FRAME_STYLES = ['painted', 'torn'] as const
type FrameStyle = typeof FRAME_STYLES[number]

// Cached frame Blob fetches — the same two ~small PNGs are reused for every masked image
const frame_cache = new Map<FrameStyle, Promise<Blob>>()

// Fetch (and cache) a frame mask PNG
function fetch_frame(style:FrameStyle):Promise<Blob> {
    let promise = frame_cache.get(style)
    if (!promise) {
        promise = fetch(`${ASSETS_PREFIX}frames/${style}.png`).then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch frame asset "${style}": ${response.status}`)
            }
            return response.blob()
        })
        frame_cache.set(style, promise)
        // Don't cache failures — a later attempt should retry
        promise.catch(() => frame_cache.delete(style))
    }
    return promise
}


// Whether a Blueprint image_style needs canvas masking (the other styles are plain Typst layout)
export function is_masked_image_style(style:ImageStyle):style is FrameStyle {
    return (FRAME_STYLES as readonly string[]).includes(style)
}


// Create a 2D canvas — a DOM element on the main thread, OffscreenCanvas inside a worker
function make_canvas(width:number, height:number):HTMLCanvasElement|OffscreenCanvas {
    if (typeof document === 'undefined') {
        return new OffscreenCanvas(width, height)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}


// Export a canvas' contents as a PNG Blob (handles both canvas types)
function canvas_png_blob(canvas:HTMLCanvasElement|OffscreenCanvas):Promise<Blob> {
    if ('convertToBlob' in canvas) {
        return canvas.convertToBlob({type: 'image/png'})
    }
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob)
            } else {
                reject(new Error('canvas.toBlob returned null'))
            }
        }, 'image/png')
    })
}


// Apply a painted/torn frame mask to a photo, at the photo's own pixel size (no crop/resize — the
// box that ultimately places the result decides how it's fit, see content_passage.ts/
// content_picture_story.ts's "contain" fit for masked styles).
//
// The frame is rotated and/or flipped so repeated images in the same document don't all look
// identical — the full symmetry group of a rectangle (4 rotations × 2 reflection axes) has 8
// distinct elements, not 16, since rotating 180° always equals flipping both axes at once
// (rotate(R + 180°) ≡ rotate(R) then flip both — a flip is a determinant -1 transform, and two of
// them compose back to a determinant +1 rotation). To land on all 8 without that collision, the
// two rotation choices used here are 90° apart rather than 180° apart: whichever step keeps the
// frame's own portrait/landscape orientation aligned with the photo's (best proportions — see
// below), and the next step around. Combined with an independent horizontal + vertical flip, that
// gives 2 × 2 × 2 = 8 genuinely distinct variants (verified by hashing each one's alpha channel —
// they don't collide). `variant` (its low 3 bits) picks which one deterministically — the caller
// passes a stable per-image number (see content_images.ts's resolve_content_for_style) so the
// same photo always renders the same way on repeat compiles, while different photos in the same
// document usually differ.
//
// Trade-off: only the orientation-matched rotation keeps the frame's own aspect proportional to
// the photo's — the other (90° off) stretches the brushstroke/torn texture's border thickness
// unevenly when the photo's aspect ratio differs a lot from the frame PNG's own. Half of the 8
// variants use it. Acceptable here since the frame textures are already irregular/organic (some
// stretch isn't very noticeable) and more per-image variety was preferred over guaranteeing
// identical proportions on every variant
export async function apply_image_frame(image:Blob, style:ImageStyle, variant:number):Promise<Blob> {
    if (!is_masked_image_style(style)) {
        return image
    }

    const [img_bitmap, frame_blob] = await Promise.all([createImageBitmap(image), fetch_frame(style)])
    const width = img_bitmap.width
    const height = img_bitmap.height

    const canvas = make_canvas(width, height)
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')!

    // Draw the photo at its own size (no cropping — see module comment)
    ctx.drawImage(img_bitmap, 0, 0, width, height)
    img_bitmap.close()

    // Pick the rotation/flip combo for this variant (see function comment)
    const frame_bitmap = await createImageBitmap(frame_blob)
    const frame_portrait = frame_bitmap.height >= frame_bitmap.width
    const canvas_portrait = height >= width
    const preferred_rot = frame_portrait === canvas_portrait ? 0 : 1
    const rot_steps = (preferred_rot + (variant & 1)) % 4
    const flip_h = Boolean((variant >> 1) & 1)
    const flip_v = Boolean((variant >> 2) & 1)
    const angle_rad = rot_steps * (Math.PI / 2)
    const scale_x = flip_h ? -1 : 1
    const scale_y = flip_v ? -1 : 1

    // When rotated 90°/270° the draw dimensions must be swapped so the frame fills the canvas in
    // screen space (the rotation exchanges width and height)
    const draw_w = rot_steps % 2 === 1 ? height : width
    const draw_h = rot_steps % 2 === 1 ? width : height

    // destination-out: opaque frame pixels erase the photo beneath them, leaving the border
    // transparent while the photo shows through untouched at the centre
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.translate(width / 2, height / 2)
    ctx.rotate(angle_rad)
    ctx.scale(scale_x, scale_y)
    ctx.drawImage(frame_bitmap, -draw_w / 2, -draw_h / 2, draw_w, draw_h)
    ctx.restore()
    frame_bitmap.close()

    return canvas_png_blob(canvas)
}
