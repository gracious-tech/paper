// Covers on the main thread (cover.ts): the worker client that renders them (one init, matched
// replies, diagnostic errors, a crash failing everything in flight), the bounded render cache that
// lets book-only edits reuse a cover, loading and uploading backgrounds, the presets a new cover
// is seeded from, and the snapshot a version freezes. The worker, Storage and the network are
// stand-ins, so what's asserted is what gets posted, fetched, stored and returned

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {make_blank_form_values} from 'bookcover-core'
import {COPYRIGHT_MARKER, COVER_TITLE_KEY} from 'paper-bible-typst'

import {make_blueprint} from './helpers/blueprint'

import type {CustomFont} from 'typst-fonts'
import type {Blueprint, CoverConfig} from '@/services/types'


// Storage: objects by path, every upload, and every download
const objects = vi.hoisted(() => new Map<string, Uint8Array>())
const storage = vi.hoisted(() => ({
    uploadBytes: vi.fn(async (path:string, bytes:Uint8Array, _meta:{contentType:string}) => {
        objects.set(path, bytes)
    }),
    getBytes: vi.fn(async (path:string) => {
        const bytes = objects.get(path)
        if (!bytes){
            throw new Error(`storage/object-not-found: ${path}`)
        }
        return bytes.buffer
    }),
}))
vi.mock('firebase/storage', () => ({ref: (_storage:unknown, path:string) => path, ...storage}))
vi.mock('@/services/firebase', () => ({firebase_storage: {}}))
vi.mock('@/services/typst', () => ({ASSETS_PREFIX: 'https://assets.test/'}))
vi.mock('@/services/compile_mode', () => ({track_browser_compile: (work:Promise<unknown>) => work}))

// The open design's uploaded fonts (the real module syncs them from Firestore)
const custom_fonts = vi.hoisted(() => [] as CustomFont[])
vi.mock('@/services/custom_fonts', () => ({custom_fonts}))


// The cover worker: every message posted to it, answered by `reply` unless a test answers itself
interface Posted {
    id:number
    action:string
    [key:string]:unknown
}
let posted:Posted[] = []
let workers:FakeWorker[] = []
let reply:((message:Posted) => unknown)|null = null

class FakeWorker {
    onmessage:((event:{data:unknown}) => void)|null = null
    onerror:((event:{message:string}) => void)|null = null
    constructor(){
        workers.push(this)
    }
    postMessage(message:Posted){
        posted.push(message)
        const answer = reply?.(message)
        if (answer !== undefined){
            queueMicrotask(() => this.onmessage?.({data: answer}))
        }
    }
    // Answer a request as the worker would
    respond(data:object){
        this.onmessage?.({data})
    }
}

// A successful render result, telling apart which request produced it
function render_result(message:Posted){
    return {id: message.id, ok: true, result: message.action === 'init' ? null
        : {data: `cover#${message.id}`, front: `front#${message.id}`, back: 'back'}}
}


// The network: background images by url
const fetched:string[] = []
function stub_fetch(responses:Record<string, Uint8Array<ArrayBuffer>|number> = {}):void{
    vi.stubGlobal('fetch', vi.fn(async (url:string) => {
        fetched.push(url)
        const answer = responses[url] ?? JPEG
        return typeof answer === 'number' ? new Response('', {status: answer})
            : new Response(answer)
    }))
}

// Leading bytes of each format, as the type sniffing reads them
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])


// A fresh copy of the module, so its worker, render cache and background cache start empty. The
// content stub is fresh too, so it's given the default design's translation here, for the
// copyright statement a cover's blurb resolves
async function load(){
    vi.resetModules()
    const {content} = await import('@/services/content')
    content.translations = {eng_bsb: {id: 'eng_bsb', language: 'eng',
        name_local: 'Berean Standard Bible', name_english: 'Berean Standard Bible',
        attribution: 'BSB Committee', licenses: [{id: 'cc0', name: 'CC0',
            url: 'https://example.org/license', restrictions: {forbid_attributionless: false,
                forbid_limitless: false, forbid_commercial: false, forbid_derivatives: false,
                forbid_other: false}}]}} as unknown as typeof content.translations
    return await import('@/services/cover')
}

// A design with a cover, from the module's own preset so the form is a real one
async function design_with_cover(cover:Partial<CoverConfig> = {},
        overrides:Partial<Blueprint> = {}):Promise<Blueprint>{
    const {seed_cover_preset} = await load_cached()
    const blueprint = make_blueprint({name: 'Psalms', ...overrides})
    return {...blueprint, cover: {...seed_cover_preset('icon', blueprint), ...cover}}
}

// The module copy the current test loaded (presets need no fresh state of their own)
let module_copy:Awaited<ReturnType<typeof load>>|null = null
async function load_cached(){
    module_copy ??= await load()
    return module_copy
}


beforeEach(async () => {
    posted = []
    workers = []
    reply = render_result
    fetched.length = 0
    objects.clear()
    custom_fonts.length = 0
    vi.clearAllMocks()
    vi.stubGlobal('Worker', FakeWorker)
    stub_fetch()
    module_copy = await load()
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('rendering through the worker', () => {

    // The worker starts once, pointed at the shared assets, and is reused after that
    it('starts one worker, initialised with the assets prefix, for every render', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover()
        expect(await cover.render_cover_pdf(blueprint, 100, 'final')).toBe('cover#1')
        await cover.render_cover_pdf(blueprint, 200, 'final')
        expect(workers).toHaveLength(1)
        expect(posted.map(message => message.action)).toEqual(['init', 'generate', 'generate'])
        expect(posted[0]).toMatchObject({action: 'init', assets_prefix: 'https://assets.test/'})
    })

    // Book-only edits reuse the render; anything the cover shows renders again
    it('reuses a render whose inputs are unchanged', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover()
        const first = await cover.render_cover_pdf(blueprint, 100, 'final')
        expect(await cover.render_cover_pdf({...blueprint, content: []}, 100, 'final'))
            .toBe(first)
        // A different spine (page count) or quality is a different cover
        await cover.render_cover_pdf(blueprint, 300, 'final')
        await cover.render_cover_pdf(blueprint, 100, 'preview')
        expect(posted.filter(message => message.action === 'generate')).toHaveLength(3)
    })

    // Bounded: once more covers than it holds have rendered, the oldest renders again
    it('forgets the oldest render once more than six are held', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover()
        for (const pages of [10, 20, 30, 40, 50, 60, 70]){
            await cover.render_cover_pdf(blueprint, pages, 'final')
        }
        const generates = () => posted.filter(message => message.action === 'generate').length
        expect(generates()).toBe(7)
        // The newest six are still held, the first isn't
        await cover.render_cover_pdf(blueprint, 70, 'final')
        expect(generates()).toBe(7)
        await cover.render_cover_pdf(blueprint, 10, 'final')
        expect(generates()).toBe(8)
    })

    // What a render hands the worker: plain data, a builtin by its id, preview caps for previews
    it('sends a builtin background by id, at the copy the quality calls for', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover({bg_image: {kind: 'builtin', id: 'hills.jpg'}})
        await cover.render_cover_pdf(blueprint, 100, 'preview')
        await cover.render_cover_pdf(blueprint, 100, 'final')
        const [preview, final] = posted.filter(message => message.action === 'generate')
        expect(preview).toMatchObject({image_builtin: 'hills.jpg', image_max_dpi: 192,
            format: 'pdf', image: {type: 'image/jpeg', key: 'preview:hills.jpg'}})
        expect(final!['image_max_dpi']).toBeUndefined()
        expect(fetched).toEqual([
            'https://assets.test/backgrounds/previews_2700/hills.jpg',
            'https://assets.test/backgrounds/hills.jpg',
        ])
    })

    // The default blurb's copyright marker is resolved here, where the licensing is known
    it('resolves the blurb\'s copyright marker into substitutions for the worker', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover()
        expect(JSON.stringify(blueprint.cover!.form['blurb'])).toContain(COPYRIGHT_MARKER)
        await cover.render_cover_pdf(blueprint, 100, 'final', undefined, 'https://paper.bible/v/x')
        expect(posted[1]!['typst_substitutions']).toBeDefined()

        // A blurb without the marker sends none
        const plain = await design_with_cover()
        plain.cover!.form['blurb'] = {type: 'doc', content: []}
        await cover.render_cover_pdf(plain, 100, 'final')
        expect(posted[2]!['typst_substitutions']).toBeUndefined()
    })

    // Font bytes are expensive to post, so they only go when the set changes
    it('posts the cover\'s custom fonts only when the set changes', async () => {
        const cover = await load_cached()
        const fonts_a = [{family: 'Mine', style: 'serif', files: [new Uint8Array([1])]}]
        const fonts_b = [{family: 'Mine', style: 'serif', files: [new Uint8Array([2])]}]
        const blueprint = await design_with_cover({font_families: ['Mine']})
        await cover.render_cover_pdf(blueprint, 100, 'final', fonts_a as CustomFont[])
        await cover.render_cover_pdf(blueprint, 200, 'final', fonts_a as CustomFont[])
        // Same family name, different bytes: a different set
        await cover.render_cover_pdf(blueprint, 300, 'final', fonts_b as CustomFont[])
        const generates = posted.filter(message => message.action === 'generate')
        expect(generates.map(message => 'fonts' in message)).toEqual([true, false, true])
        expect(generates[0]!['fonts_key']).not.toBe(generates[2]!['fonts_key'])
        // Only the families the cover uses go at all
        const unused = [{family: 'Other', style: 'serif', files: [new Uint8Array([3])]}]
        await cover.render_cover_pdf(blueprint, 400, 'final', unused as CustomFont[])
        expect(posted.at(-1)!['fonts']).toEqual([])
    })

    // Asking for a cover the design doesn't have is a programming error
    it('refuses to render a design without a cover', async () => {
        const cover = await load_cached()
        await expect(cover.render_cover_pdf(make_blueprint(), 100, 'final'))
            .rejects.toThrow('without a cover')
    })

    // The panels come back separately, for the preview and the 3D picture
    it('renders the panels as SVG at preview quality', async () => {
        const cover = await load_cached()
        const panels = await cover.render_cover_panels(await design_with_cover(), 100)
        expect(panels).toEqual({wraparound: 'cover#1', front: 'front#1', back: 'back'})
        expect(posted[1]).toMatchObject({format: 'svg', image_max_dpi: 192})
    })

    // A failed render names where it was in the worker's life, with the worker's own stack
    it('fails with the worker\'s error, its stack, and the call\'s place', async () => {
        const cover = await load_cached()
        reply = message => message.action === 'init' ? render_result(message)
            : {id: message.id, ok: false, error: 'out of memory', stack: 'at render (worker.js)'}
        const error = await cover.render_cover_pdf(await design_with_cover(), 100, 'final')
            .catch((thrown:Error) => thrown)
        expect((error as Error).message)
            .toMatch(/^out of memory \(cover worker: action=generate, call=#1, age=\d+s\)$/)
        expect((error as Error).stack).toContain('Worker stack:\nat render (worker.js)')
    })

    // A reply for no request in flight (one already settled) is ignored
    it('ignores a reply to no request', async () => {
        const cover = await load_cached()
        await cover.render_cover_pdf(await design_with_cover(), 100, 'final')
        expect(() => workers[0]!.respond({id: 99, ok: true, result: null})).not.toThrow()
    })

    // The worker script itself crashing fails everything in flight, since nothing will answer
    it('fails every render in flight when the worker crashes', async () => {
        const cover = await load_cached()
        reply = message => message.action === 'init' ? render_result(message) : undefined
        const blueprint = await design_with_cover()
        const first = cover.render_cover_pdf(blueprint, 100, 'final')
        const second = cover.render_cover_pdf(blueprint, 200, 'final')
        await vi.waitFor(() => expect(posted).toHaveLength(3))
        workers[0]!.onerror!({message: ''})
        await expect(first).rejects.toThrow(/^Cover worker failed \(cover worker: action=worker crash/)
        await expect(second).rejects.toThrow('Cover worker failed')
    })

})


describe('backgrounds', () => {

    // A custom background comes from Storage, once, typed by its bytes rather than its name
    it('loads a custom background once, typed by what its bytes are', async () => {
        const cover = await load_cached()
        objects.set('design_assets/d1/abc.jpg', WEBP)
        const config = {bg_image: {kind: 'custom', path: 'design_assets/d1/abc.jpg', hash: 'abc'}}
        const first = await cover.load_cover_bg(config as CoverConfig, 'final')
        await cover.load_cover_bg(config as CoverConfig, 'preview')
        expect(first).toEqual({data: WEBP, type: 'image/webp'})
        // One hash, one download, whichever copy is asked for
        expect(storage.getBytes).toHaveBeenCalledOnce()
    })

    // No background, nothing to load
    it('loads nothing for a cover without a background', async () => {
        const cover = await load_cached()
        expect(await cover.load_cover_bg({bg_image: null} as CoverConfig, 'final')).toBe(null)
    })

    // A failed download isn't remembered, so the next render tries again
    it('downloads a background again after a failure', async () => {
        const cover = await load_cached()
        const config = {bg_image: {kind: 'builtin', id: 'gone.jpg'}} as CoverConfig
        stub_fetch({'https://assets.test/backgrounds/gone.jpg': 404})
        await expect(cover.load_cover_bg(config, 'final')).rejects.toThrow(/404/)
        stub_fetch()
        expect((await cover.load_cover_bg(config, 'final'))!.type).toBe('image/jpeg')
    })

    // An upload lands under the design, named by its hash and real type, and is then held
    it('uploads a background under the design by its hash and real type', async () => {
        const cover = await load_cached()
        const {path, hash} = await cover.upload_cover_bg('d1', PNG, 'image/jpeg')
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        expect(path).toBe(`design_assets/d1/${hash}.png`)
        expect(storage.uploadBytes).toHaveBeenCalledWith(path, PNG, {contentType: 'image/png'})

        // The bytes are in hand already, so rendering with it downloads nothing
        await cover.load_cover_bg({bg_image: {kind: 'custom', path, hash}} as CoverConfig, 'final')
        expect(storage.getBytes).not.toHaveBeenCalled()
    })

    // An unrecognised upload keeps the browser's label, defaulting to jpg for the name
    it('keeps the browser\'s type for bytes it can\'t recognise', async () => {
        const cover = await load_cached()
        const bytes = new Uint8Array([1, 2, 3])
        expect((await cover.upload_cover_bg('d1', bytes, 'image/gif')).path).toMatch(/\.jpg$/)
        expect(storage.uploadBytes.mock.calls[0]![2]).toEqual({contentType: 'image/gif'})
    })

    // A suggested background is handed to the widget as the File its own upload would make
    it('hands a suggested background over as a File named by its basename', async () => {
        const cover = await load_cached()
        objects.set('design_assets/other/f00d.jpg', PNG)
        const file = await cover.load_bg_suggestion('design_assets/other/f00d.jpg')
        expect(file.name).toBe('f00d.jpg')
        expect(file.type).toBe('image/png')
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG)
    })

    // A version's background moved back into a live design, typed by its extension
    it('plans moving a version\'s background back into a design', async () => {
        const cover = await load_cached()
        expect(cover.plan_cover_bg_into_design('version_assets/d1/abc.webp', 'd2')).toEqual({
            path: 'design_assets/d2/abc.webp',
            copy: {from: 'version_assets/d1/abc.webp', to: 'design_assets/d2/abc.webp',
                content_type: 'image/webp'},
        })
    })

    // The wizard's cards use bookcover's small copies
    it('points at bookcover\'s 800px copy of a builtin', async () => {
        const cover = await load_cached()
        expect(cover.builtin_bg_800_url('hills.jpg'))
            .toBe('https://assets.test/backgrounds/previews_800/hills.jpg')
    })

})


describe('presets', () => {

    // The default title follows the design, and the blurb carries the copyright marker
    it('seeds a first cover with the design\'s title and the copyright marker', async () => {
        const cover = await load_cached()
        const form = cover.default_cover_preset(make_blueprint({name: 'Psalms'}))
        expect(form[COVER_TITLE_KEY]).toBe('Psalms')
        expect(JSON.stringify(form['blurb'])).toContain(COPYRIGHT_MARKER)
        expect(form['title_margin_top']).toBe(8)
        expect(form['bg_image']).toBeUndefined()
    })

    // Home printers can't reach the edge, so their covers get a matte and wider margins
    it('gives home-printed covers a white margin and wider panels', async () => {
        const cover = await load_cached()
        const form = cover.default_cover_preset(make_blueprint({service_id: 'home'}))
        expect([form['home_print_margin'], form['margin_front'], form['margin_back']])
            .toEqual([true, 10, 7])
    })

    // A narrow book's back panel needs a tighter margin to fit its blurb (not folded, so the
    // trim is the page)
    it('tightens the back margin on a narrow book', async () => {
        const cover = await load_cached()
        const narrow = cover.default_cover_preset(make_blueprint({service_id: 'custom',
            booklet: false, size_id: '', custom_unit: 'inch', custom_trim_width: 5,
            custom_trim_height: 8}))
        expect(narrow['home_print_margin']).toBe(false)
        expect(narrow['margin_back']).toBe(3)
        const wide = cover.default_cover_preset(make_blueprint({service_id: 'custom',
            booklet: false, size_id: '', custom_unit: 'inch', custom_trim_width: 6,
            custom_trim_height: 9}))
        // A wide one keeps bookcover's own default
        expect(wide['margin_back']).toBe(make_blank_form_values()['margin_back'])
        expect(wide['margin_back']).not.toBe(3)
    })

    // Each wizard style: a tinted vector, an icon on a pattern, or a book-themed photo
    it('seeds each wizard style', async () => {
        const cover = await load_cached()
        const blueprint = make_blueprint({content: [{type: 'passage', id: 'p1', book: 'gen',
            start_chapter: 1, start_verse: null, end_chapter: 1, end_verse: null} as never]})
        const pattern = cover.seed_cover_preset('pattern', blueprint)
        expect(pattern.form['bg_vector_id']).toBe('cross-v2')
        expect(pattern.bg_image).toBe(null)
        const icon = cover.seed_cover_preset('icon', blueprint)
        expect(icon.form['icon_id']).toBeTruthy()
        expect(icon.form['pattern_id']).toBe('morphing-diamonds')
        const photo = cover.seed_cover_preset('photo', blueprint)
        expect(photo.bg_image).toEqual({kind: 'builtin', id: 'earth_whole.jpg'})
        expect(photo.form['bg_image_coverage']).toBe('full')

        // With no passage, the photo falls back to a fixed default and the icon to an open book
        const empty = make_blueprint({content: []})
        expect(cover.seed_cover_preset('photo', empty).bg_image)
            .toEqual({kind: 'builtin', id: 'cross_sun.jpg'})
        expect(cover.seed_cover_preset('icon', empty).form['icon_id']).toBe('game-icons:open-book')
    })

    // A wizard card renders the front panel as SVG from bookcover's small copy
    it('renders a wizard card\'s front panel from the small copy of its photo', async () => {
        const cover = await load_cached()
        const svg = await cover.render_wizard_cover_preview('photo', make_blueprint({content: []}))
        expect(svg).toBe('front#1')
        expect(fetched).toEqual(['https://assets.test/backgrounds/previews_800/cross_sun.jpg'])
        expect(posted[1]).toMatchObject({format: 'svg', image: {key: 'override:cross_sun.jpg'}})

        // A pattern card has nothing to fetch
        fetched.length = 0
        await cover.render_wizard_cover_preview('pattern', make_blueprint({content: []}))
        expect(fetched).toEqual([])
    })

    // The design's name flows to the cover's title until the user writes their own
    it('carries the design\'s name onto the cover until its title is set by hand', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover({title_custom: false}, {name: '  New name '})
        cover.apply_name_to_cover(blueprint)
        expect(blueprint.cover!.form[COVER_TITLE_KEY]).toBe('New name')

        // A blank name would wipe the title, and a hand-set title is the user's
        blueprint.name = '  '
        cover.apply_name_to_cover(blueprint)
        expect(blueprint.cover!.form[COVER_TITLE_KEY]).toBe('New name')
        blueprint.name = 'Other'
        blueprint.cover!.title_custom = true
        cover.apply_name_to_cover(blueprint)
        expect(blueprint.cover!.form[COVER_TITLE_KEY]).toBe('New name')
    })

})


describe('cover details', () => {

    // Only uploaded families need snapshotting; bookcover's own are bundled
    it('lists the uploaded font families a form uses', async () => {
        const cover = await load_cached()
        custom_fonts.push({family: 'Mine', style: 'serif', files: []} as CustomFont)
        const form = {...cover.default_cover_preset(make_blueprint()), title1_font: 'Mine',
            title2_font: 'Bevan'}
        expect(cover.cover_font_families(form)).toEqual(['Mine'])
    })

    // A remembered preview cover is only shown while it still matches the design's cover
    it('shows the last previewed cover only while it matches the design', async () => {
        const cover = await load_cached()
        const config = (await design_with_cover()).cover!
        cover.remember_previewed_cover('d1', cover.cover_json(config), '<svg/>')
        expect(cover.previewed_cover_svg('d1', config)).toBe('<svg/>')
        expect(cover.previewed_cover_svg('d2', config)).toBe(null)
        expect(cover.previewed_cover_svg('d1', null)).toBe(null)
        expect(cover.previewed_cover_svg('d1', {...config, title_custom: true})).toBe(null)
    })

    // A vector is drawn over the cover's colour, or bookcover's default tint
    it('colours a vector background from the cover, or bookcover\'s default', async () => {
        const cover = await load_cached()
        const config = (await design_with_cover()).cover!
        config.form['bg_color'] = '#336699'
        expect(cover.vector_bg_color(config)).toMatch(/^hsl/)
        config.form['bg_color'] = null
        expect(cover.vector_bg_color(config)).toBeTruthy()
        // No vector, or a background image over it, means no vector to draw
        expect(await cover.vector_bg_svg({...config, form: {}})).toBe(null)
        expect(await cover.vector_bg_svg({...config, form: {bg_vector_id: 'cross-v2'},
            bg_image: {kind: 'builtin', id: 'hills.jpg'}})).toBe(null)
    })

})


describe('plan_version_cover', () => {

    // Nothing to freeze without a cover
    it('freezes nothing for a design without a cover', async () => {
        const cover = await load_cached()
        expect(cover.plan_version_cover('d1', make_blueprint())).toEqual({frozen: null, copies: []})
    })

    // A builtin is already public and immutable, so it's kept as a reference
    it('keeps a builtin background as the reference it is', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover({bg_image: {kind: 'builtin', id: 'hills.jpg'}})
        const {frozen, copies} = cover.plan_version_cover('d1', blueprint)
        expect(frozen!.bg_image).toEqual({kind: 'builtin', id: 'hills.jpg'})
        expect(copies).toEqual([])
        // A copy, so editing the design can't change the frozen config
        expect(frozen).not.toBe(blueprint.cover)
    })

    // An upload is snapshotted under the version prefix, so editing the design can't change it
    it('snapshots an uploaded background into version_assets/', async () => {
        const cover = await load_cached()
        const blueprint = await design_with_cover({bg_image: {kind: 'custom',
            path: 'design_assets/d1/abc.png', hash: 'abc'}})
        const {frozen, copies} = cover.plan_version_cover('d1', blueprint)
        expect(frozen!.bg_image).toEqual({kind: 'custom', path: 'version_assets/d1/abc.png',
            hash: 'abc'})
        expect(copies).toEqual([{from: 'design_assets/d1/abc.png',
            to: 'version_assets/d1/abc.png', content_type: 'image/png'}])
        // The design's own config still points at its live copy
        expect(blueprint.cover!.bg_image).toMatchObject({path: 'design_assets/d1/abc.png'})
    })

})
