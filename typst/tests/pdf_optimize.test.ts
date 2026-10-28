import {describe, it, expect, vi, afterEach} from 'vitest'
import {PDFArray, PDFDocument, PDFName, PDFRawStream} from 'pdf-lib'

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

    // Below 256 bytes a Filter entry costs more than deflating saves
    it('leaves small streams uncompressed', async () => {
        const doc = await PDFDocument.create()
        const stream = doc.context.register(doc.context.stream(new Uint8Array(200).fill(65)))
        doc.addPage().node.set(PDFName.of('PieceInfo'), stream)
        await optimize_pdf(doc)
        expect(raw_streams(doc).every(obj => !obj.dict.get(PDFName.of('Filter')))).toBe(true)
    })

    // Random bytes don't deflate smaller, so the stream is kept as it was
    it('leaves a stream uncompressed when deflating would not shrink it', async () => {
        const doc = await PDFDocument.create()
        const noise = crypto.getRandomValues(new Uint8Array(4096))
        const stream = doc.context.register(doc.context.stream(noise))
        doc.addPage().node.set(PDFName.of('PieceInfo'), stream)
        await optimize_pdf(doc)
        const kept = raw_streams(doc).find(obj => obj.getContents().length === 4096)
        expect(kept?.dict.get(PDFName.of('Filter'))).toBeUndefined()
    })

    it('drops objects nothing in the document refers to', async () => {
        const {doc} = await doc_with_raw_stream()
        const orphan = doc.context.register(doc.context.obj({Orphan: true}))
        await optimize_pdf(doc)
        expect(doc.context.lookup(orphan)).toBeUndefined()
    })

    // Byte-identical streams collapse to one, and every reference follows to the survivor
    it('dedups identical streams, repointing what referred to the dropped copy', async () => {
        const doc = await PDFDocument.create()
        const bytes = new TextEncoder().encode('identical content\n'.repeat(40))
        const first = doc.context.register(doc.context.stream(bytes))
        const second = doc.context.register(doc.context.stream(bytes))
        const page_a = doc.addPage()
        const page_b = doc.addPage()
        page_a.node.set(PDFName.of('PieceInfo'), first)
        page_b.node.set(PDFName.of('PieceInfo'), doc.context.obj([second]))
        await optimize_pdf(doc)
        const survivor = page_a.node.get(PDFName.of('PieceInfo'))
        expect(raw_streams(doc).filter(obj => obj.getContents().length > 0)).toHaveLength(1)
        expect(String((page_b.node.lookup(PDFName.of('PieceInfo'), PDFArray)).get(0)))
            .toBe(String(survivor))
    })

    // A stream whose dict refers elsewhere can match another byte for byte yet mean
    // something else (two font programs with different descriptors, say), so both stay
    it('keeps identical streams apart when their dicts hold references', async () => {
        const doc = await PDFDocument.create()
        const bytes = new TextEncoder().encode('identical content\n'.repeat(40))
        const targets = [doc.context.obj({A: 1}), doc.context.obj({B: 2})]
            .map(obj => doc.context.register(obj))
        const streams = targets.map(target => doc.context.register(
            doc.context.stream(bytes, {Extra: target})))
        doc.addPage().node.set(PDFName.of('PieceInfo'), streams[0]!)
        doc.addPage().node.set(PDFName.of('PieceInfo'), streams[1]!)
        await optimize_pdf(doc)
        expect(streams.map(ref => doc.context.lookup(ref))
            .every(obj => obj instanceof PDFRawStream)).toBe(true)
    })
})


// Every raw (not object-stream) stream left in the document
function raw_streams(doc:PDFDocument):PDFRawStream[] {
    return doc.context.enumerateIndirectObjects()
        .map(([, obj]) => obj)
        .filter((obj):obj is PDFRawStream => obj instanceof PDFRawStream)
}
