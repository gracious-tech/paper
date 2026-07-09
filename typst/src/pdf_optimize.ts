
import {PDFDocument, PDFDict, PDFArray, PDFRawStream, PDFRef, PDFName, PDFNumber} from 'pdf-lib'

import type {PDFObject} from 'pdf-lib'


// Shrink a merged/imposed PDF before saving. pdf-lib's copyPages/embedPages duplicate shared
// resources (Typst font subsets especially) on every call, and embedPages also leaves orphaned
// copies of the source pages behind, so multi-compile outputs bloat to several times their
// necessary size. Three passes fix that: sweep unreachable objects, compress raw streams
// (Typst leaves ToUnicode CMaps uncompressed), and dedup byte-identical streams. Takes only a
// few ms even on large documents, so it is safe to run on every output.
export async function optimize_pdf(doc:PDFDocument):Promise<void> {
    gc_objects(doc)
    await compress_streams(doc)
    await dedup_streams(doc)
}


// Collect all refs contained within an object graph node into `out`
function collect_refs(obj:PDFObject|undefined, out:PDFRef[]):void {
    if (obj instanceof PDFRef) {
        out.push(obj)
    } else if (obj instanceof PDFDict) {
        for (const [, value] of obj.entries()) {
            collect_refs(value, out)
        }
    } else if (obj instanceof PDFArray) {
        for (let i = 0; i < obj.size(); i++) {
            collect_refs(obj.get(i), out)
        }
    } else if (obj instanceof PDFRawStream) {
        collect_refs(obj.dict, out)
    }
}


// Mark-and-sweep unreachable indirect objects (embedPages leaves orphaned page copies behind)
function gc_objects(doc:PDFDocument):number {
    const ctx = doc.context

    // Mark everything reachable from the trailer
    const reachable = new Set<string>()
    const queue:PDFRef[] = []
    for (const root of [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt]) {
        collect_refs(root as PDFObject|undefined, queue)
    }
    while (queue.length) {
        const ref = queue.pop() as PDFRef
        const key = ref.toString()
        if (reachable.has(key)) {
            continue
        }
        reachable.add(key)
        collect_refs(ctx.lookup(ref), queue)
    }

    // Sweep the rest
    let removed = 0
    for (const [ref] of ctx.enumerateIndirectObjects()) {
        if (!reachable.has(ref.toString())) {
            ctx.delete(ref)
            removed += 1
        }
    }
    return removed
}


// Flate-compress sizeable uncompressed streams via the standard CompressionStream API
async function compress_streams(doc:PDFDocument):Promise<number> {
    const ctx = doc.context
    let compressed = 0
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Filter'))) {
            continue
        }
        const raw = obj.getContents()
        if (raw.length < 256) {
            continue  // Not worth the dict overhead
        }
        const packed = await deflate(raw)
        if (packed.length >= raw.length) {
            continue
        }
        obj.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
        obj.dict.set(PDFName.of('Length'), PDFNumber.of(packed.length))
        ctx.assign(ref, PDFRawStream.of(obj.dict, packed))
        compressed += 1
    }
    return compressed
}


// Compress bytes as zlib deflate (the format PDF's FlateDecode filter expects)
async function deflate(data:Uint8Array):Promise<Uint8Array> {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream()
        .pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}


// Deduplicate byte-identical streams by remapping every reference to a single canonical copy.
// Both copyPages and embedPages re-copy shared resources per call, so a document assembled
// page by page holds many identical copies of each font subset — this collapses them
async function dedup_streams(doc:PDFDocument):Promise<number> {
    const ctx = doc.context

    // Group identical streams, keeping the first of each as canonical
    const by_key = new Map<string, PDFRef>()
    const remap = new Map<string, PDFRef>()
    const drop:PDFRef[] = []
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) {
            continue
        }
        const key = await stream_key(obj)
        if (key === null) {
            continue
        }
        const canonical = by_key.get(key)
        if (canonical) {
            remap.set(ref.toString(), canonical)
            drop.push(ref)
        } else {
            by_key.set(key, ref)
        }
    }
    if (!remap.size) {
        return 0
    }

    // Rewrite every reference to a dropped stream to point at its canonical copy. The trailer
    // is skipped since its refs (catalog, info) never point at raw streams
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
        remap_refs(obj, remap)
    }
    for (const ref of drop) {
        ctx.delete(ref)
    }
    return remap.size
}


// Identity key for a stream: its dict entries plus a hash of its bytes. Returns null when the
// dict contains refs, since two such streams may be identical in bytes yet differ in meaning
async function stream_key(stream:PDFRawStream):Promise<string|null> {
    let key = ''
    for (const [name, value] of stream.dict.entries()) {
        if (has_refs(value)) {
            return null
        }
        key += `${name.toString()}=${value.toString()};`
    }
    const contents = stream.getContents()
    const digest = await crypto.subtle.digest('SHA-256',
        contents as Uint8Array<ArrayBuffer>)
    return key + '|' + Array.from(new Uint8Array(digest),
        byte => byte.toString(16).padStart(2, '0')).join('')
}


// Whether an object graph node contains any indirect references
function has_refs(obj:PDFObject):boolean {
    const refs:PDFRef[] = []
    collect_refs(obj, refs)
    return refs.length > 0
}


// Replace refs throughout an object graph node according to `remap` (keyed by ref string)
function remap_refs(obj:PDFObject, remap:Map<string, PDFRef>):void {
    if (obj instanceof PDFDict) {
        for (const [name, value] of obj.entries()) {
            if (value instanceof PDFRef) {
                const target = remap.get(value.toString())
                if (target) {
                    obj.set(name, target)
                }
            } else {
                remap_refs(value, remap)
            }
        }
    } else if (obj instanceof PDFArray) {
        for (let i = 0; i < obj.size(); i++) {
            const value = obj.get(i)
            if (value instanceof PDFRef) {
                const target = remap.get(value.toString())
                if (target) {
                    obj.set(i, target)
                }
            } else {
                remap_refs(value, remap)
            }
        }
    } else if (obj instanceof PDFRawStream) {
        remap_refs(obj.dict, remap)
    }
}
