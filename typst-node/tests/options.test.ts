
// The CLI wrapper's handling of everything around the source: binary assets written beside it,
// curated and custom font directories passed as --font-path, the CLI's own errors, and compiling
// straight from a Blueprint. The CLI is run through a wrapper script that records each call's
// arguments, so what reaches it can be asserted without depending on any font being installed

import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {PDFDocument} from 'pdf-lib'
import {BibleContent} from 'paper-bible-typst'

import {compile_pdf, compile_svg_preview, compile_pdf_from_blueprint} from '../src/index.js'
import {make_blueprint, make_passage, make_request} from '../../typst/tests/fixtures.js'

import type {BibleCollection, GetResourcesItem} from '@gracious.tech/fetch-client'
import type {CustomFont} from '../src/index.js'


// A 1x1 transparent PNG, small enough to inline
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
    + '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), char => char.charCodeAt(0))

// A custom font's stand-in bytes (never rendered with, only written and pointed at)
const FAKE_FONT:CustomFont = {family: 'Uploaded Font', style: 'serif',
    files: [new Uint8Array([0, 1, 0, 0])]}


// The scratch directory: the recording wrapper, its log, and a curated fonts tree
let dir:string
let typst_path:string
let log_path:string
let fonts_dir:string

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'typst-node-options-'))
    log_path = join(dir, 'calls.log')
    typst_path = join(dir, 'typst-recording')
    // One line per argument, then a separator per call, before handing over to the real CLI
    await writeFile(typst_path, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log_path}'\n`
        + `echo '---' >> '${log_path}'\nexec typst "$@"\n`)
    await chmod(typst_path, 0o755)

    // A curated manifest naming the fixtures' body font, with an (empty) directory for it
    fonts_dir = join(dir, 'fonts')
    await mkdir(join(fonts_dir, 'Crimson Pro'), {recursive: true})
    await writeFile(join(fonts_dir, 'manifest.json'), JSON.stringify([
        {family: 'Crimson Pro', group: 'serif', style: 'serif', files: ['CrimsonPro.ttf'],
            preview_file: 'CrimsonPro.ttf'},
    ]))
})

afterAll(async () => {
    await rm(dir, {recursive: true, force: true})
})


// Every --font-path the recorded calls passed, then clear the log for the next test
async function font_paths_passed():Promise<string[]>{
    const args = (await readFile(log_path, 'utf8')).split('\n')
    await writeFile(log_path, '')
    return args.flatMap((arg, i) => arg === '--font-path' ? [args[i + 1]!] : [])
}


// A passage carrying an image, with its bytes in the request's assets as the resolver puts them
function image_request(){
    const filename = 'passage_img_p1.png'
    return make_request({
        content: [make_passage({image: {filename, bytes: PNG}})],
        assets: {[filename]: PNG},
    })
}


describe('compile_pdf options', () => {

    it('writes a passage image beside the source so the CLI can find it', async () => {
        const doc = await PDFDocument.load(await compile_pdf(image_request()))
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    }, 30000)

    it('passes the curated font dirs a request needs, extras, and custom fonts', async () => {
        await writeFile(log_path, '')
        await compile_pdf(make_request(), {typst_path, fonts_dir, font_paths: ['/extra/fonts'],
            custom_fonts: [FAKE_FONT]})
        const paths = await font_paths_passed()
        expect(paths).toContain(join(fonts_dir, 'Crimson Pro'))
        expect(paths).toContain('/extra/fonts')
        // The upload is written into the compile's own temp dir, which is gone afterwards
        expect(paths.some(path => path.endsWith('/fonts/Uploaded Font'))).toBe(true)
    }, 30000)

    it('lets a custom font replace a curated one of the same name', async () => {
        await writeFile(log_path, '')
        await compile_pdf(make_request(), {typst_path, fonts_dir,
            custom_fonts: [{...FAKE_FONT, family: 'Crimson Pro'}]})
        const paths = await font_paths_passed()
        expect(paths).not.toContain(join(fonts_dir, 'Crimson Pro'))
        expect(paths.some(path => path.endsWith('/fonts/Crimson Pro'))).toBe(true)
    }, 30000)

    it('rejects with the CLI\'s own error output when the source fails to compile', async () => {
        const broken = make_passage({bibles: [{content: '#not_a_function()'}]})
        await expect(compile_pdf(make_request({content: [broken]})))
            .rejects.toThrow(/Typst compilation failed: [\s\S]*not_a_function/)
    }, 30000)

})


describe('compile_svg_preview options', () => {

    it('writes assets and custom fonts for the SVG compile too', async () => {
        await writeFile(log_path, '')
        const pages = await compile_svg_preview(image_request(), {typst_path,
            custom_fonts: [FAKE_FONT]})
        expect(pages.length).toBeGreaterThanOrEqual(1)
        expect(pages.some(page => page.inner.includes('<image'))).toBe(true)
        expect((await font_paths_passed()).some(path => path.endsWith('/fonts/Uploaded Font')))
            .toBe(true)
    }, 30000)

})


describe('compile_pdf_from_blueprint', () => {

    // A one-translation collection holding Genesis, standing in for fetch.bible
    const resource = {
        id: 'eng_test', language: 'eng', direction: 'ltr', year: 2000, attribution: '',
        attribution_url: '', licenses: [], tags: [], name: 'Test Bible', name_abbrev: 'TB',
        name_english: 'Test Bible', name_english_abbrev: 'TB', name_local: 'Test Bible',
        name_local_abbrev: 'TB', name_bilingual: 'Test Bible', name_bilingual_abbrev: 'TB',
    } as unknown as GetResourcesItem
    const collection = {
        get_resources: () => ({eng_test: resource}),
        get_books: () => ({gen: {name: 'Genesis', available: true}}),
        fetch_book: () => Promise.resolve({
            get_passage_from_ref: () => '#ch(1)\n#vn(1)In the beginning.',
        }),
        reference_to_string: () => 'Genesis 1',
    } as unknown as BibleCollection

    it('resolves the blueprint\'s content and compiles it with its fonts', async () => {
        await writeFile(log_path, '')
        const blueprint = make_blueprint({bibles: ['eng_test'], content: [{
            type: 'passage', id: 'p1', book: 'gen', start_chapter: 1, start_verse: null,
            end_chapter: 1, end_verse: null, title: null, title_subtitle: '', title_icon: null,
            image: null,
        }]})
        const progress:string[] = []
        const pdf = await compile_pdf_from_blueprint(blueprint, {
            content: new BibleContent({collection}), typst_path, fonts_dir,
            doc_name: 'From a blueprint', on_progress: event => progress.push(event.stage),
        })
        const doc = await PDFDocument.load(pdf)
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
        expect(doc.getTitle()).toBe('From a blueprint')
        expect(progress).toContain('fetch')
        expect(await font_paths_passed()).toContain(join(fonts_dir, 'Crimson Pro'))
    }, 30000)

})
