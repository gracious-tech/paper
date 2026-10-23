import {describe, it, expect, vi, afterEach} from 'vitest'
import {PDFDocument, PDFName, PDFRawStream} from 'pdf-lib'

import {optimize_pdf} from '../src/pdf_optimize.js'


// A document holding one sizeable, highly compressible stream with no filter, like the ToUnicode
// CMaps Typst leaves uncompressed
async function doc_with_raw_stream():Promise<{doc:PDFDocument, raw:Uint8Array}> {
    const doc = await PDFDocument.create()
    const raw = new TextEncoder().encode('beginbfchar <0001> <0041> endbfchar\n'.repeat(100))
    const stream = doc.context.register(doc.context.stream(raw))
    doc.addPage().node.set(PDFName.of('PieceInfo'), stream)
    return {doc, raw}
}


// The only stream in the document that carries a filter (the one compress_streams packed)
function filtered_stream(doc:PDFDocument):PDFRawStream {
    const found = doc.context.enumerateIndirectObjects()
        .map(([, obj]) => obj)
        .filter(obj => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Filter')))
    expect(found).toHaveLength(1)
    return found[0] as PDFRawStream
}


describe('optimize_pdf', () => {

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('flate-compresses unfiltered streams', async () => {
        const {doc, raw} = await doc_with_raw_stream()
        await optimize_pdf(doc)
        const stream = filtered_stream(doc)
        expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
        expect(stream.getContents().length).toBeLessThan(raw.length)
    })

    it('still compresses where CompressionStream is missing (Safari before 16.4)', async () => {
        vi.stubGlobal('CompressionStream', undefined)
        const {doc, raw} = await doc_with_raw_stream()
        await optimize_pdf(doc)
        const stream = filtered_stream(doc)
        expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
        expect(stream.getContents().length).toBeLessThan(raw.length)
        // Still a valid PDF once saved
        expect((await PDFDocument.load(await doc.save())).getPageCount()).toBe(1)
    })
})
