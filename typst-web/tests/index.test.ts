
// The browser's Typst engine (typst.ts's WASM compiler), run in Node. typst-node's suite only
// shells out to the Typst CLI, so this is the one place the engine the app actually compiles
// with is exercised outside a browser: font loading and reloading, the manifest retry, compile
// errors, SVG output and custom-font blob URLs. Every fetch is answered locally (the two WASM
// modules from node_modules, a made-up font manifest), so it needs no assets or network — and
// since the manifest's font files 404, documents compile without glyphs unless the optional
// real-font fixture below is present. The WASM modules are once-per-realm singletons, so only the
// first test to need each one fetches it: nothing here may depend on a module being refetched

import {existsSync, readFileSync} from 'node:fs'
import {resolveObjectURL} from 'node:buffer'
import {join} from 'node:path'

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {PDFDict, PDFDocument, PDFName} from 'pdf-lib'

import {init} from '../src/index.ts'
import {make_passage, make_request, make_title, TEST_TYPOGRAPHY}
    from '../../typst/tests/fixtures.ts'

import type {CustomFont} from 'typst-fonts'


// The WASM modules as the app would fetch them
const NODE_MODULES = join(import.meta.dirname, '../../node_modules/@myriaddreamin')
const COMPILER_WASM = readFileSync(
    join(NODE_MODULES, 'typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm'))
const RENDERER_WASM = readFileSync(
    join(NODE_MODULES, 'typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm'))

// Where the stubbed fetch serves them from
const ORIGIN = 'https://typst-web.test'
const OPTIONS = {
    wasm_url: `${ORIGIN}/compiler.wasm`,
    renderer_wasm_url: `${ORIGIN}/renderer.wasm`,
    assets_prefix: `${ORIGIN}/assets/`,
}

// The curated manifest: the fixtures' body and title fonts (the first is the base font)
const MANIFEST = [
    {family: 'Crimson Pro', group: 'serif', style: 'serif', files: ['CrimsonPro.ttf'],
        preview_file: 'CrimsonPro.ttf'},
    {family: 'Dancing Script', group: 'script', style: 'script', files: ['Dancing.ttf'],
        preview_file: 'Dancing.ttf'},
]


// Every url fetched this test, and per-test overrides that answer before the defaults
let fetched:string[] = []
let override:((url:string) => Response|null)|null = null


// Answer the engine's fetches: the WASM modules, the manifest, blob URLs (custom fonts) as
// Node's own registry holds them, and a 404 for everything else (the font files)
async function stub_fetch(input:RequestInfo|URL):Promise<Response>{
    const url = input instanceof Request ? input.url : String(input)
    fetched.push(url)
    const answer = override?.(url)
    if (answer){
        return answer
    }
    if (url.startsWith('blob:')){
        const blob = resolveObjectURL(url)
        if (!blob){
            throw new TypeError(`Revoked blob URL fetched: ${url}`)
        }
        return new Response(await blob.arrayBuffer())
    }
    const wasm = {[OPTIONS.wasm_url]: COMPILER_WASM, [OPTIONS.renderer_wasm_url]: RENDERER_WASM}[url]
    if (wasm){
        return new Response(wasm, {headers: {'content-type': 'application/wasm'}})
    }
    if (url === `${ORIGIN}/assets/fonts/manifest.json`){
        return new Response(JSON.stringify(MANIFEST), {headers: {'content-type': 'application/json'}})
    }
    return new Response('Not found', {status: 404})
}


// Which of the fetched urls were curated font files
function font_files_fetched():string[]{
    return fetched.filter(url => url.endsWith('.ttf'))
}


// Every BaseFont a PDF embeds (Typst packs font dicts into object streams, so walk pdf-lib's
// parsed objects rather than searching the raw bytes)
async function base_fonts(pdf:Uint8Array):Promise<string[]>{
    const doc = await PDFDocument.load(pdf)
    const names:string[] = []
    for (const [, obj] of doc.context.enumerateIndirectObjects()){
        const name = obj instanceof PDFDict ? obj.get(PDFName.of('BaseFont')) : undefined
        if (name){
            names.push(name.toString())
        }
    }
    return names
}


beforeEach(() => {
    fetched = []
    override = null
    vi.stubGlobal('fetch', stub_fetch)
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('compile_pdf', () => {

    it('compiles a request to a PDF of the requested page size', async () => {
        const web = await init(OPTIONS)
        const doc = await PDFDocument.load(await web.compile_pdf(make_request()))
        expect(doc.getPageCount()).toBe(1)
        // 148mm x 210mm (TEST_PAGE), in points
        const {width, height} = doc.getPage(0).getSize()
        expect(width).toBeCloseTo(148 / 25.4 * 72, 0)
        expect(height).toBeCloseTo(210 / 25.4 * 72, 0)
    })

    it('loads the files of the fonts a request uses, and only when that set changes', async () => {
        const web = await init(OPTIONS)
        await web.compile_pdf(make_request())
        expect(font_files_fetched()).toEqual([`${ORIGIN}/assets/fonts/Crimson%20Pro/CrimsonPro.ttf`])

        // Same fonts again: the compiler is reused, nothing refetched
        fetched = []
        await web.compile_pdf(make_request({title: 'Another'}))
        expect(font_files_fetched()).toEqual([])

        // A title page brings in its own font, so the compiler is rebuilt with both
        await web.compile_pdf(make_request({content: [make_title(), make_passage()]}))
        expect(font_files_fetched().sort()).toEqual([
            `${ORIGIN}/assets/fonts/Crimson%20Pro/CrimsonPro.ttf`,
            `${ORIGIN}/assets/fonts/Dancing%20Script/Dancing.ttf`,
        ])
    })

    it('retries the font manifest after a failed fetch, rather than failing for good', async () => {
        // The manifest is first fetched as the engine starts, and that attempt fails
        override = url => url.endsWith('manifest.json') ? new Response('', {status: 503}) : null
        const web = await init(OPTIONS)
        await expect(web.compile_pdf(make_request())).rejects.toThrow(/503/)

        // Once the server's back, the next compile fetches it again and goes through
        override = null
        fetched = []
        const doc = await PDFDocument.load(await web.compile_pdf(make_request()))
        expect(doc.getPageCount()).toBe(1)
        expect(fetched.filter(url => url.endsWith('manifest.json'))).toHaveLength(1)
    })

    it('throws Typst\'s diagnostics when the generated source fails to compile', async () => {
        const web = await init(OPTIONS)
        const broken = make_passage({bibles: [{content: '#not_a_function()'}]})
        await expect(web.compile_pdf(make_request({content: [broken]})))
            .rejects.toThrow(/\[typst-web\] Typst compilation failed:[\s\S]*not_a_function/)
    })

    it('starts out unworn', async () => {
        const web = await init(OPTIONS)
        await web.compile_pdf(make_request())
        expect(web.worn).toBe(false)
    })

})


describe('custom fonts', () => {

    // Stand-in bytes: the engine takes them without complaint, and nothing renders with them
    const fake_font = (family:string):CustomFont =>
        ({family, style: 'serif', files: [new Uint8Array([0, 1, 0, 0, 0, 0])]})

    it('loads a used custom font from a blob URL, and a same-named one beats the curated', async () => {
        const web = await init(OPTIONS)
        web.set_custom_fonts([fake_font('Crimson Pro')])
        await web.compile_pdf(make_request())
        expect(fetched.filter(url => url.startsWith('blob:'))).toHaveLength(1)
        expect(font_files_fetched()).toEqual([])
    })

    it('ignores a custom font no part of the request uses', async () => {
        const web = await init(OPTIONS)
        web.set_custom_fonts([fake_font('Unused Upload')])
        await web.compile_pdf(make_request())
        expect(fetched.filter(url => url.startsWith('blob:'))).toEqual([])
    })

    it('revokes the previous fonts\' blob URLs once a new set is loaded', async () => {
        const web = await init(OPTIONS)
        web.set_custom_fonts([fake_font('Crimson Pro')])
        await web.compile_pdf(make_request())
        const [first] = fetched.filter(url => url.startsWith('blob:'))

        // Re-setting the fonts makes the next compile reload them as a fresh blob URL
        web.set_custom_fonts([fake_font('Crimson Pro')])
        await web.compile_pdf(make_request())
        expect(resolveObjectURL(first!)).toBeUndefined()
    })

    it('revokes a failed reload\'s blob URLs and retries cleanly on the next compile', async () => {
        const web = await init(OPTIONS)
        web.set_custom_fonts([fake_font('Crimson Pro')])

        // The title page's curated font comes from the network beside the custom one's blob;
        // drop the connection for it once
        override = url => {
            if (url.endsWith('Dancing.ttf')){
                throw new TypeError('Failed to fetch')
            }
            return null
        }
        const request = make_request({content: [make_title(), make_passage()]})
        await expect(web.compile_pdf(request)).rejects.toThrow()
        const failed = fetched.filter(url => url.startsWith('blob:'))
        expect(failed).toHaveLength(1)
        expect(resolveObjectURL(failed[0]!)).toBeUndefined()

        override = null
        const doc = await PDFDocument.load(await web.compile_pdf(request))
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
    })

    // A real font, from the untracked assets/ tree (the bookcover repo's), so this skips rather
    // than fails where it isn't linked in — as typst-node's equivalent does
    const fixture_path = join(import.meta.dirname, '../../assets/fonts/Bevan/Bevan-Regular.ttf')

    it.skipIf(!existsSync(fixture_path))('embeds an uploaded font used as the body font', async () => {
        const web = await init(OPTIONS)
        web.set_custom_fonts([{family: 'Bevan', style: 'serif',
            files: [new Uint8Array(readFileSync(fixture_path))]}])
        const pdf = await web.compile_pdf(make_request({
            typography: {...TEST_TYPOGRAPHY, font_text: 'Bevan'},
        }))
        expect((await base_fonts(pdf)).some(name => name.includes('Bevan'))).toBe(true)
    })

})


describe('SVG output', () => {

    it('previews a request as one standalone SVG per page', async () => {
        const web = await init(OPTIONS)
        const pages = await web.compile_svg_preview(make_request({
            content: [make_title(), make_passage()],
        }))
        // The title page and the passage, each its own page
        expect(pages.length).toBeGreaterThanOrEqual(2)
        for (const page of pages){
            expect(page.width).toBeGreaterThan(0)
            expect(page.inner).toContain('typst-group')
        }
    })

    it('sizes a single-image SVG in points, as browsers would otherwise read pixels', async () => {
        const web = await init(OPTIONS)
        const svg = await web.compile_svg(make_request())
        const root = /<svg[^>]*>/.exec(svg)![0]
        expect(root).toMatch(/width="[\d.]+pt"/)
        expect(root).toMatch(/height="[\d.]+pt"/)
    })

    it('refuses SVG output when no renderer module was given', async () => {
        const web = await init({...OPTIONS, renderer_wasm_url: undefined})
        await expect(web.compile_svg(make_request())).rejects.toThrow(/renderer_wasm_url/)
    })

})
