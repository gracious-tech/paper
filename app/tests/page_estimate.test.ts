
// The page-count estimate (page_estimate.ts): how a preview window's page count is scaled up to
// the whole document, when an estimate is kept (only for the content it was computed from), and
// when none is compiled at all (no engine, server mode, missing books). The window compile, the
// Bible resolve and the truncation are stand-ins each test controls

import {describe, it, expect, beforeEach, vi} from 'vitest'

import {blue, estimated_pages, set_blue} from './stubs/state'
import {bible_content} from './stubs/content'

import type {Blueprint} from '@/services/types'


// The collaborators each test drives
const mocks = vi.hoisted(() => ({
    truncate: vi.fn(),
    compiles_on_server: vi.fn(() => false),
    has_missing_books: vi.fn(() => false),
    resolve_content_for_style: vi.fn(async (_id:string, content:unknown[]) => content),
    report_error: vi.fn(),
    design_id: {value: 'design_1' as string|null},
    generator: {value: null as unknown},
}))

vi.mock('paper-bible-typst', () => ({truncate_for_preview: mocks.truncate, ESTIMATE_CHAR_LIMIT: 5000}))
vi.mock('@/services/blueprints', () => ({
    collect_passage_books: () => [],
    has_missing_books: mocks.has_missing_books,
}))
vi.mock('@/services/designs', () => ({current_design_id: mocks.design_id}))
vi.mock('@/services/typst', () => ({typst_generator: mocks.generator}))
vi.mock('@/services/custom_fonts', () => ({get_custom_font_styles: () => []}))
vi.mock('@/services/content_images', () => ({
    resolve_content_for_style: mocks.resolve_content_for_style,
}))
vi.mock('@/services/errors', () => ({report_error: mocks.report_error}))
vi.mock('@/services/display', () => ({use_is_mobile: () => ({value: true})}))
vi.mock('@/services/compile_progress', () => ({compiling_here: {value: false}}))
vi.mock('@/services/compile_mode', () => ({
    compiles_on_server: mocks.compiles_on_server,
    within_timeout: <T>(promise:Promise<T>, _ms:number, on_timeout:() => void) =>
        promise.catch((error:unknown) => {
            on_timeout()
            throw error
        }),
}))


import {
    compile_preview_window, ensure_page_estimate, estimate_pages_for, fresh_estimate,
    render_signature, set_page_estimate,
} from '@/services/page_estimate'


// The engine: compiles a window to however many pages the test says
const compile_svg_preview = vi.fn()
const abandon = vi.fn()
const generator = {compile_svg_preview, abandon} as never


// A design with a little content
const DESIGN = {name: 'My Bible', bibles: ['eng_bsb'], content: [{id: 'c1'}], image_style: 'plain'}


// Have the next window compile cover this share of the document and produce this many pages
function next_window(pages:number, window_chars:number, total_chars:number):void{
    mocks.truncate.mockImplementationOnce(request => ({
        request, window_chars, total_chars,
        truncated: window_chars < total_chars, dropped_before: false, dropped_after: false,
    }))
    compile_svg_preview.mockResolvedValueOnce(new Array(pages).fill({inner: ''}))
}


beforeEach(() => {
    vi.clearAllMocks()
    mocks.compiles_on_server.mockReturnValue(false)
    mocks.has_missing_books.mockReturnValue(false)
    mocks.design_id.value = 'design_1'
    mocks.generator.value = generator
    set_blue({...DESIGN} as unknown as Partial<Blueprint>)
    // Forget any estimate a previous test kept
    set_page_estimate(0, 'nothing')
    estimated_pages.value = null
    Object.assign(bible_content, {resolve: vi.fn(async (blueprint:unknown) => ({blueprint}))})
})


describe('render_signature', () => {

    it('ignores the design\'s name, which never changes what renders', () => {
        const signature = render_signature()
        blue.name = 'Renamed'
        expect(render_signature()).toBe(signature)
        blue.bibles = ['eng_web']
        expect(render_signature()).not.toBe(signature)
    })

})


describe('compile_preview_window', () => {

    it('estimates exactly from an untruncated window, rounded up to whole leaves', async () => {
        next_window(5, 1000, 1000)
        const result = await compile_preview_window(generator, 'start', 9000)
        expect(result.page_estimate).toBe(6)
        expect(result.signature).toBe(render_signature())
        expect(result.share_url).toBe('https://paper.bible/designs/design_1')
    })

    it('scales a truncated window\'s pages by how much of the document it covered', async () => {
        // A tenth of the text made 7 pages: about 70 for the whole
        next_window(7, 1000, 10_000)
        expect((await compile_preview_window(generator, 'start', 1000)).page_estimate).toBe(70)
    })

    it('never estimates fewer than two pages, even for an empty window', async () => {
        next_window(0, 0, 0)
        expect((await compile_preview_window(generator, 'start', 1000)).page_estimate).toBe(2)
    })

    it('compiles a snapshot instead of the open design when given one', async () => {
        next_window(2, 10, 10)
        const snapshot = {...DESIGN, bibles: ['eng_web']} as unknown as Blueprint
        const result = await compile_preview_window(generator, 'start', 1000, undefined,
            {source: {blueprint: snapshot, design_id: 'design_2'}})
        expect(result.signature).toBe(render_signature(snapshot))
        expect(result.share_url).toBe('https://paper.bible/designs/design_2')
        expect(mocks.resolve_content_for_style).toHaveBeenCalledWith('design_2', DESIGN.content,
            'plain')
    })

    it('leaves images alone and has no share link before a design is open', async () => {
        mocks.design_id.value = null
        next_window(2, 10, 10)
        const result = await compile_preview_window(generator, 'start', 1000)
        expect(result.share_url).toBeUndefined()
        expect(mocks.resolve_content_for_style).not.toHaveBeenCalled()
    })

    it('tells the caller when the compile itself starts', async () => {
        next_window(2, 10, 10)
        const on_compile = vi.fn(() => expect(compile_svg_preview).not.toHaveBeenCalled())
        await compile_preview_window(generator, 'start', 1000, undefined, {on_compile})
        expect(on_compile).toHaveBeenCalledTimes(1)
    })

    it('abandons the engine when a timed compile fails', async () => {
        mocks.truncate.mockImplementationOnce(request => ({request, window_chars: 1, total_chars: 1}))
        compile_svg_preview.mockRejectedValueOnce(new Error('slow'))
        await expect(compile_preview_window(generator, 'start', 1000, undefined,
            {timeout_ms: 10})).rejects.toThrow('slow')
        expect(abandon).toHaveBeenCalled()
    })

})


describe('ensure_page_estimate', () => {

    it('compiles an estimate for the open design and keeps it', async () => {
        next_window(9, 100, 100)
        await ensure_page_estimate()
        expect(estimated_pages.value).toBe(10)
        expect(fresh_estimate(blue)).toBe(10)
    })

    it('doesn\'t compile again while the estimate is still for this content', async () => {
        next_window(9, 100, 100)
        await ensure_page_estimate()
        await ensure_page_estimate()
        expect(compile_svg_preview).toHaveBeenCalledTimes(1)

        // A rename changes nothing that renders; an edit does
        blue.name = 'Renamed'
        await ensure_page_estimate()
        expect(compile_svg_preview).toHaveBeenCalledTimes(1)
        blue.content = [{id: 'c2'}] as never
        next_window(3, 100, 100)
        await ensure_page_estimate()
        expect(compile_svg_preview).toHaveBeenCalledTimes(2)
        expect(estimated_pages.value).toBe(4)
    })

    it('has concurrent callers share one compile', async () => {
        next_window(9, 100, 100)
        await Promise.all([ensure_page_estimate(), ensure_page_estimate()])
        expect(compile_svg_preview).toHaveBeenCalledTimes(1)
    })

    it('drops an estimate of content the user edited away while it compiled', async () => {
        mocks.truncate.mockImplementationOnce(request => ({request, window_chars: 1, total_chars: 1}))
        compile_svg_preview.mockImplementationOnce(async () => {
            blue.content = [{id: 'edited'}] as never
            return [{inner: ''}, {inner: ''}]
        })
        await ensure_page_estimate()
        expect(estimated_pages.value).toBe(null)
    })

    it('reports a failed compile and never throws, keeping what it had', async () => {
        estimated_pages.value = 40
        mocks.truncate.mockImplementationOnce(request => ({request, window_chars: 1, total_chars: 1}))
        compile_svg_preview.mockRejectedValueOnce(new Error('out of memory'))
        await expect(ensure_page_estimate()).resolves.toBeUndefined()
        expect(estimated_pages.value).toBe(40)
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {context: {stage: 'page_estimate'}})
    })

    it('compiles nothing without an engine, in server mode, or with books missing', async () => {
        mocks.generator.value = null
        await ensure_page_estimate()
        mocks.generator.value = generator
        mocks.compiles_on_server.mockReturnValue(true)
        await ensure_page_estimate()
        mocks.compiles_on_server.mockReturnValue(false)
        mocks.has_missing_books.mockReturnValue(true)
        await ensure_page_estimate()
        expect(compile_svg_preview).not.toHaveBeenCalled()
    })

})


describe('estimate_pages_for', () => {

    it('uses the shared estimate while the snapshot is still the open design', async () => {
        next_window(5, 100, 100)
        const snapshot = {...blue} as Blueprint
        expect(await estimate_pages_for(snapshot, 'design_1')).toBe(6)
        // ...and so keeps the shared estimate current too
        expect(fresh_estimate(blue)).toBe(6)
    })

    it('compiles a snapshot the open design has moved on from, on its own', async () => {
        next_window(11, 100, 100)
        const snapshot = {...DESIGN, content: [{id: 'old'}]} as unknown as Blueprint
        expect(await estimate_pages_for(snapshot, 'design_1')).toBe(12)
        // The open design's estimate isn't touched by a snapshot's
        expect(estimated_pages.value).toBe(null)
    })

    it('is null when it can\'t be worked out, and never throws', async () => {
        const snapshot = {...DESIGN, content: [{id: 'old'}]} as unknown as Blueprint
        mocks.has_missing_books.mockReturnValue(true)
        expect(await estimate_pages_for(snapshot, 'design_1')).toBe(null)

        mocks.has_missing_books.mockReturnValue(false)
        mocks.compiles_on_server.mockReturnValue(true)
        expect(await estimate_pages_for(snapshot, 'design_1')).toBe(null)

        mocks.compiles_on_server.mockReturnValue(false)
        mocks.truncate.mockImplementationOnce(request => ({request, window_chars: 1, total_chars: 1}))
        compile_svg_preview.mockRejectedValueOnce(new Error('broken'))
        expect(await estimate_pages_for(snapshot, 'design_1')).toBe(null)
        expect(mocks.report_error).toHaveBeenCalled()
    })

})
