
// Splitting a rendered wraparound cover PDF into one page per face, for covers printed as separate
// pages (see cover_prints_split). Kept apart from cover.ts so pdf-lib is only bundled where this
// is actually called, not wherever the cover helpers are

import {PDFDocument} from 'pdf-lib'
import {resolve_dimensions} from 'bookcover-core'

import type {PDFPage} from 'pdf-lib'
import type {DimensionInputs} from 'bookcover-core'


// Turn a one-page wraparound cover PDF into a two-page PDF: the front face, then the back face.
// `form` is the render form the cover was generated from (see cover_form_for_render), so the faces
// fall exactly where bookcover laid them out. Both pages share one copy of the source page's
// content and resources, each just boxed to its own face
export async function split_cover_pdf(pdf:Uint8Array, form:Record<string, unknown>)
        :Promise<Uint8Array>{
    const dims = resolve_dimensions(form as unknown as DimensionInputs)
    const mm_to_pt = (mm:number) => mm / 25.4 * 72
    const source = await PDFDocument.load(pdf)
    const sheet = source.getPage(0).getMediaBox()

    // One copier call for both pages, so the background image etc. is only embedded once
    const out = await PDFDocument.create()
    const [front, back] = await out.copyPages(source, [0, 0]) as [PDFPage, PDFPage]
    const faces = [[front, dims.cover_region_front], [back, dims.cover_region_back]] as const
    for (const [page, region] of faces){
        // bookcover's regions are mm from the top-left, PDF boxes are pt from the bottom-left
        const x = sheet.x + mm_to_pt(region.x.toNumber())
        const width = mm_to_pt(region.w.toNumber())
        const height = mm_to_pt(region.h.toNumber())
        const y = sheet.y + sheet.height - mm_to_pt(region.y.toNumber()) - height
        page.setMediaBox(x, y, width, height)
        page.setCropBox(x, y, width, height)
        out.addPage(page)
    }
    return await out.save()
}
