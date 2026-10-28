// The open design's uploaded fonts (custom_fonts.ts): mirroring the design doc's `fonts` map into
// the reactive set without re-downloading what's held, adding (content-addressed, replacing a
// family rather than keeping both) and removing families, and snapshotting the ones a blueprint
// uses into version_assets/. Firestore, Storage, hashing and the worker are stand-ins, so what's
// asserted is the paths, doc updates and set contents that result

import {describe, it, expect, beforeEach, vi} from 'vitest'

import {make_blueprint} from './helpers/blueprint'

import type {StoredFontMeta} from 'paper-bible-typst'
import type {CustomFont} from 'typst-fonts'


// Firestore: field paths and deletes as readable values, and every update made
const update_doc = vi.hoisted(() => vi.fn(async (..._args:unknown[]) => undefined))
vi.mock('firebase/firestore', () => ({
    doc: (_db:unknown, collection:string, id:string) => `${collection}/${id}`,
    updateDoc: update_doc,
    FieldPath: class {
        segments:string[]
        constructor(...segments:string[]){
            this.segments = segments
        }
    },
    deleteField: () => 'DELETE',
}))

// Storage: stored objects' bytes, by path
const objects = vi.hoisted(() => new Map<string, Uint8Array>())
const upload_bytes = vi.hoisted(() => vi.fn(async (path:string, bytes:Uint8Array,
        _metadata?:{contentType:string}) => {
    objects.set(path, bytes)
}))
const get_bytes = vi.hoisted(() => vi.fn(async (path:string) => objects.get(path)!.buffer))
vi.mock('firebase/storage', () => ({
    ref: (_storage:unknown, path:string) => path,
    uploadBytes: upload_bytes,
    getBytes: get_bytes,
}))
vi.mock('@/services/firebase', () => ({firestore: {}, firebase_storage: {}}))

// The font parser, the preview registration (needs document.fonts) and the generator's worker
const process_font_files = vi.hoisted(() => vi.fn())
vi.mock('typst-fonts', () => ({process_font_files}))
const register_preview = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('typst-fonts/web', () => ({register_custom_font_preview: register_preview}))
const worker_fonts = vi.hoisted(() => vi.fn(async (_fonts:CustomFont[]) => undefined))
vi.mock('@/services/typst', () => ({typst_generator: {value: {set_custom_fonts: worker_fonts}}}))

// Hashing stays content-based (a stand-in digest of the bytes); reconciling is just noted
vi.mock('@/services/cover', () => ({
    hash_bytes: async (bytes:Uint8Array) => `h${[...bytes].join('')}`,
}))
const request_reconcile = vi.hoisted(() => vi.fn())
vi.mock('@/services/design_assets', () => ({request_reconcile}))

const fonts = await import('@/services/custom_fonts')
const {custom_fonts, design_font_meta} = fonts


// A font family with one file per given byte
function font(family:string, ...bytes:number[]):CustomFont{
    return {family, style: 'serif', files: bytes.map(byte => new Uint8Array([byte]))}
}

// The OpenType magic number, which is what labels a file font/otf
const OTTO = [0x4f, 0x54, 0x54, 0x4f]


// The families held, and the doc's entries as family -> files
function held():string[]{
    return custom_fonts.map(item => item.family)
}
function meta_files():Record<string, string[]>{
    return Object.fromEntries(Object.values(design_font_meta).map(entry =>
        [entry.family, entry.files]))
}


// The field paths and values of the last doc update, as [field, value] pairs
function last_update():[string, unknown][]{
    const args = update_doc.mock.lastCall!.slice(1)
    const pairs:[string, unknown][] = []
    for (let i = 0; i < args.length; i += 2){
        pairs.push([(args[i] as {segments:string[]}).segments.join('.'), args[i + 1]])
    }
    return pairs
}


beforeEach(() => {
    fonts.clear_design_fonts()
    objects.clear()
    for (const mock of [update_doc, upload_bytes, get_bytes, process_font_files, register_preview,
        worker_fonts, request_reconcile]){
        mock.mockClear()
    }
})


describe('add_design_fonts', () => {

    // Bytes go under the design's prefix by content, labelled by what they really are
    it('uploads a new family by content hash, records it, and holds its bytes', async () => {
        const added = await fonts.add_design_fonts('d1', [font('Lora', 1, 2), {
            family: 'Inter', style: 'sans', files: [new Uint8Array(OTTO)]}])
        expect(added).toEqual(['Lora', 'Inter'])
        expect(upload_bytes.mock.calls.map(call => [call[0], call[2]])).toEqual([
            ['design_assets/d1/h1.bin', {contentType: 'font/ttf'}],
            ['design_assets/d1/h2.bin', {contentType: 'font/ttf'}],
            ['design_assets/d1/h79848479.bin', {contentType: 'font/otf'}],
        ])
        expect(meta_files()).toEqual({Lora: ['design_assets/d1/h1.bin', 'design_assets/d1/h2.bin'],
            Inter: ['design_assets/d1/h79848479.bin']})
        expect(held()).toEqual(['Lora', 'Inter'])
        expect(register_preview).toHaveBeenCalledTimes(2)
        expect(worker_fonts).toHaveBeenCalledWith(custom_fonts)
        expect(request_reconcile).toHaveBeenCalledWith('d1')
    })

    // The cover editor hands back its whole store every time: a family already held costs a hash
    it('does nothing for a family the design already has with the same files', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1)])
        update_doc.mockClear()
        upload_bytes.mockClear()
        expect(await fonts.add_design_fonts('d1', [font('Lora', 1)])).toEqual(['Lora'])
        expect(upload_bytes).not.toHaveBeenCalled()
        expect(update_doc).not.toHaveBeenCalled()
    })

    // Re-uploading is how a wrong file is fixed, so the old entry goes rather than staying
    it('replaces a family\'s entry when it\'s uploaded with different files', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1)])
        const [old_id] = Object.keys(design_font_meta)
        await fonts.add_design_fonts('d1', [font('Lora', 5)])
        const update = last_update()
        expect(update[0]).toEqual([`fonts.${old_id}`, 'DELETE'])
        expect(update[1]![1]).toEqual({family: 'Lora', style: 'serif',
            files: ['design_assets/d1/h5.bin']})
        expect(Object.keys(design_font_meta)).not.toContain(old_id)
        expect(meta_files()).toEqual({Lora: ['design_assets/d1/h5.bin']})
        expect([...custom_fonts[0]!.files[0]!]).toEqual([5])
    })

    // Given the same family twice in one call, the last one wins
    it('keeps the last of a family given twice', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1), font('Lora', 2)])
        expect(meta_files()).toEqual({Lora: ['design_assets/d1/h2.bin']})
    })

})


describe('upload_custom_fonts', () => {

    // Files are read and handed to the shared parser, whose families are then added
    it('parses the uploaded files and adds the families they hold', async () => {
        process_font_files.mockReturnValueOnce([font('Lora', 3)])
        const file = new File([new Uint8Array([3, 3])], 'Lora.ttf')
        expect(await fonts.upload_custom_fonts('d1', [file])).toEqual(['Lora'])
        expect(process_font_files).toHaveBeenCalledWith(
            [{name: 'Lora.ttf', data: new Uint8Array([3, 3])}])
        expect(held()).toEqual(['Lora'])
    })

})


describe('load_design_fonts', () => {

    // A doc entry, stored with its bytes
    function stored(family:string, byte:number):StoredFontMeta{
        const path = `design_assets/d1/h${byte}.bin`
        objects.set(path, new Uint8Array([byte]))
        return {family, style: 'serif', files: [path]}
    }

    // The doc's map mirrored into the set: new families downloaded, gone ones dropped
    it('downloads new families and drops ones the doc no longer names', async () => {
        await fonts.load_design_fonts({a: stored('Lora', 1), b: stored('Inter', 2)})
        expect(held()).toEqual(['Lora', 'Inter'])
        expect(worker_fonts).toHaveBeenCalledTimes(1)

        await fonts.load_design_fonts({a: stored('Lora', 1)})
        expect(held()).toEqual(['Lora'])
        expect(Object.keys(design_font_meta)).toEqual(['a'])
        expect(worker_fonts).toHaveBeenCalledTimes(2)
    })

    // A co-editor's unrelated change re-sends the same map: nothing is fetched again
    it('downloads nothing it already holds the same files of', async () => {
        await fonts.load_design_fonts({a: stored('Lora', 1)})
        get_bytes.mockClear()
        worker_fonts.mockClear()
        await fonts.load_design_fonts({a: stored('Lora', 1)})
        expect(get_bytes).not.toHaveBeenCalled()
        expect(worker_fonts).not.toHaveBeenCalled()
    })

    // Two entries for one family (co-editors adding it at once) hold its bytes once
    it('holds a family named by two entries once', async () => {
        await fonts.load_design_fonts({a: stored('Lora', 1), b: stored('Lora', 2)})
        expect(held()).toEqual(['Lora'])
        expect([...custom_fonts[0]!.files[0]!]).toEqual([1])
    })

    // A family whose files changed is downloaded again and replaces what was held
    it('replaces a family whose files changed', async () => {
        await fonts.load_design_fonts({a: stored('Lora', 1)})
        await fonts.load_design_fonts({b: stored('Lora', 2)})
        expect(held()).toEqual(['Lora'])
        expect([...custom_fonts[0]!.files[0]!]).toEqual([2])
    })

})


describe('remove_design_font', () => {

    // Every entry for the family goes from the doc; the bytes are left for the server to reclaim
    it('deletes every entry for the family and drops its bytes', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1), font('Inter', 2)])
        const lora_ids = Object.entries(design_font_meta)
            .filter(([, entry]) => entry.family === 'Lora').map(([id]) => id)
        request_reconcile.mockClear()
        await fonts.remove_design_font('d1', 'Lora')
        expect(last_update()).toEqual(lora_ids.map(id => [`fonts.${id}`, 'DELETE']))
        expect(held()).toEqual(['Inter'])
        expect(meta_files()).toEqual({Inter: ['design_assets/d1/h2.bin']})
        expect(request_reconcile).toHaveBeenCalledWith('d1')
    })

    // Removing a family the design doesn't have writes nothing
    it('does nothing for a family the design doesn\'t have', async () => {
        await fonts.remove_design_font('d1', 'Missing')
        expect(update_doc).not.toHaveBeenCalled()
        expect(request_reconcile).not.toHaveBeenCalled()
    })

})


describe('plan_version_fonts', () => {

    // Only families the blueprint uses — book fonts and the cover's — are snapshotted, by the
    // same basename under version_assets/, labelled as the original was
    it('snapshots the families the book and cover use into version_assets/', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1), {family: 'Inter', style: 'sans',
            files: [new Uint8Array(OTTO)]}, font('Unused', 9)])
        const blueprint = make_blueprint({font_text: 'Lora', cover: {form: {}, bg_image: null,
            font_families: ['Inter'], title_custom: false} as never})
        const {meta, copies} = fonts.plan_version_fonts('d1', blueprint)
        expect(meta).toEqual([
            {family: 'Lora', style: 'serif', files: ['version_assets/d1/h1.bin']},
            {family: 'Inter', style: 'sans', files: ['version_assets/d1/h79848479.bin']},
        ])
        expect(copies).toEqual([
            {from: 'design_assets/d1/h1.bin', to: 'version_assets/d1/h1.bin',
                content_type: 'font/ttf'},
            {from: 'design_assets/d1/h79848479.bin', to: 'version_assets/d1/h79848479.bin',
                content_type: 'font/otf'},
        ])
    })

    // A held family the doc has no matching entry for can't be located, so it's left out
    it('leaves out a held family with no matching doc entry', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1)])
        for (const key of Object.keys(design_font_meta)){
            delete design_font_meta[key]
        }
        expect(fonts.plan_version_fonts('d1', make_blueprint({font_text: 'Lora'})))
            .toEqual({meta: [], copies: []})
    })

})


describe('get_custom_font_styles', () => {

    // Family -> style, for matching Noto fallbacks to a custom font
    it('maps each held family to its style', async () => {
        await fonts.add_design_fonts('d1', [font('Lora', 1),
            {family: 'Inter', style: 'sans', files: [new Uint8Array([2])]}])
        expect(fonts.get_custom_font_styles()).toEqual({Lora: 'serif', Inter: 'sans'})
    })

})
