
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {BibleContent, resolve_declared_cjk_variant, repair_manifest}
    from '../src/bible_content.js'
import {make_blueprint} from './fixtures.js'

import type {BibleCollection, GetResourcesItem} from '@gracious.tech/fetch-client'
import type {Blueprint, ContentPassage, ContentPictureStory, TypstPassage, TypstPictureStory,
    TypstTitlePage} from '../src/types.js'


// Minimal fake resource, overridden per test — only language/script/region matter here
function make_resource(overrides:Partial<GetResourcesItem> = {}):GetResourcesItem {
    return {
        id: 'fake', language: 'eng', script: undefined, region: undefined, direction: 'ltr',
        year: 2000, attribution: '', attribution_url: '', licenses: [], tags: [], name: '',
        name_abbrev: '', name_english: '', name_english_abbrev: '', name_local: '',
        name_local_abbrev: '', name_bilingual: '', name_bilingual_abbrev: '', ...overrides,
    }
}


// Track fetch_collection calls without any network (hoisted so the module mock can use it)
const {fetch_collection} = vi.hoisted(() => {
    return {fetch_collection: vi.fn(() => Promise.resolve(
        {bibles: {fake: true}, notes: {get_resources: () => ({})}}))}
})

// Replace FetchClient with a stub that returns a fake collection; keep everything else real
vi.mock('@gracious.tech/fetch-client', async importOriginal => {
    const original = await importOriginal<typeof import('@gracious.tech/fetch-client')>()
    return {
        ...original,
        FetchClient: class {
            fetch_collection = fetch_collection
            requester = {request: () => Promise.resolve('')}
        },
    }
})


describe('BibleContent.init collection TTL', () => {

    beforeEach(() => {
        fetch_collection.mockClear()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('fetches the collection once and no-ops on re-init by default', async () => {
        const content = new BibleContent({endpoint: 'http://example.invalid/'})
        await content.init()
        await content.init()
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(1)
    })

    it('re-fetches once the TTL has lapsed', async () => {
        const content = new BibleContent({
            endpoint: 'http://example.invalid/',
            manifest_ttl_ms: 60 * 60 * 1000,
        })
        await content.init()
        // Still fresh — no refetch
        vi.advanceTimersByTime(30 * 60 * 1000)
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(1)
        // Stale — refetch
        vi.advanceTimersByTime(31 * 60 * 1000)
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(2)
        // Fresh again after the refetch
        await content.init()
        expect(fetch_collection).toHaveBeenCalledTimes(2)
    })

    it('never fetches when a collection was injected', async () => {
        const content = new BibleContent({
            collection: {fake: true} as unknown as BibleCollection,
            manifest_ttl_ms: 1,
        })
        vi.advanceTimersByTime(1000)
        await content.init()
        expect(fetch_collection).not.toHaveBeenCalled()
        expect(content.collection).toEqual({fake: true})
    })
})


// TODO Temporary: remove with repair_manifest once fetch.bible's manifest is fixed upstream
describe('repair_manifest', () => {

    it('fills a missing language name from the other, else the code', () => {
        const repaired = JSON.parse(repair_manifest(JSON.stringify({
            bibles: {tig_mdw: {}},
            languages: {
                tig: {english: 'Tigre', pop: 1, direction: 'ltr'},
                abc: {local: 'Abc', english: ''},
                xyz: {pop: null},
                eng: {local: 'English', english: 'English'},
            },
        })))
        expect(repaired.bibles).toEqual({tig_mdw: {}})
        expect(repaired.languages.tig).toEqual(
            {local: 'Tigre', english: 'Tigre', pop: 1, direction: 'ltr'})
        expect(repaired.languages.abc).toMatchObject({local: 'Abc', english: 'Abc'})
        expect(repaired.languages.xyz).toMatchObject({local: 'xyz', english: 'xyz'})
        expect(repaired.languages.eng).toMatchObject({local: 'English', english: 'English'})
    })
})


describe('resolve_declared_cjk_variant', () => {

    it('returns undefined for an untagged resource, so callers fall back to text detection', () => {
        expect(resolve_declared_cjk_variant(undefined)).toBeUndefined()
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn'}))).toBeUndefined()
    })

    it('resolves Japanese/Korean from the language code alone, ignoring script/region', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'jpn'}))).toBe('JP')
        expect(resolve_declared_cjk_variant(make_resource({language: 'kor'}))).toBe('KR')
    })

    it('resolves Simplified Chinese from script alone', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn', script: 'Hans'})))
            .toBe('SC')
    })

    it('defaults Traditional Chinese to TC when no region is declared', () => {
        expect(resolve_declared_cjk_variant(make_resource({language: 'cmn', script: 'Hant'})))
            .toBe('TC')
    })

    it('resolves Traditional Chinese to HK when the region is declared', () => {
        expect(resolve_declared_cjk_variant(
            make_resource({language: 'cmn', script: 'Hant', region: 'HK'})))
            .toBe('HK')
    })
})


describe('title null/empty/string fallback resolution', () => {

    // A fake collection whose reference_to_string always returns a fixed sentinel, regardless
    // of the passage — the private resolvers under test only care whether/how they call it, not
    // what a real reference string looks like (that's PassageReference's own concern)
    const reference_to_string = vi.fn(() => 'AUTO_REF')
    const collection = {reference_to_string} as unknown as BibleCollection
    const content = new BibleContent({collection})
    const blue = {bibles: ['eng']} as Blueprint

    const make_passage = (overrides:Partial<ContentPassage> = {}):ContentPassage => ({
        type: 'passage', id: 'p1', book: 'gen', start_chapter: 1, start_verse: null,
        end_chapter: 1, end_verse: null, title: null, title_subtitle: '', title_icon: null,
        image: null, ...overrides,
    })

    const make_story = (overrides:Partial<ContentPictureStory> = {}):ContentPictureStory => ({
        type: 'picture_story', id: 's1', title: null, title_subtitle: '', title_icon: null,
        slides: [], ...overrides,
    })

    beforeEach(() => {
        reference_to_string.mockClear()
    })

    it('passage: a null title falls back to the reference', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(blue, make_passage())
        expect(title).toBe('AUTO_REF')
        expect(reference_to_string).toHaveBeenCalledTimes(1)
    })

    it("passage: an explicit '' title stays suppressed, without calling reference_to_string", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(blue, make_passage({title: ''}))
        expect(title).toBe('')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('passage: a literal custom title passes through unchanged', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_passage_title(
            blue, make_passage({title: 'My Title'}))
        expect(title).toBe('My Title')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('picture story: a null title falls back to a reference spanning its passage slides', () => {
        const story = make_story({slides: [
            {id: 'sl1', image: null, mode: 'passage', book: 'gen', start_chapter: 1,
                start_verse: null, end_chapter: 1, end_verse: null, doc: {type: 'doc', content: []}},
            {id: 'sl2', image: null, mode: 'text', book: '', start_chapter: null,
                start_verse: null, end_chapter: null, end_verse: null, doc: {type: 'doc', content: []}},
        ]})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('AUTO_REF')
        expect(reference_to_string).toHaveBeenCalledTimes(1)
    })

    it('picture story: a null title with no passage-mode slides stays suppressed', () => {
        const story = make_story({slides: [
            {id: 'sl1', image: null, mode: 'text', book: '', start_chapter: null,
                start_verse: null, end_chapter: null, end_verse: null, doc: {type: 'doc', content: []}},
        ]})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('')
        expect(reference_to_string).not.toHaveBeenCalled()
    })

    it('picture story: a literal custom title passes through unchanged', () => {
        const story = make_story({title: 'My Story'})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const title = (content as any).effective_picture_story_title(blue, story)
        expect(title).toBe('My Story')
        expect(reference_to_string).not.toHaveBeenCalled()
    })
})


describe('BibleContent picture story direction', () => {

    const content = new BibleContent({endpoint: 'http://example.invalid/'})
    const resources = {
        heb: make_resource({id: 'heb', language: 'heb', direction: 'rtl'}),
        eng: make_resource({id: 'eng'}),
    }
    // A Hebrew + English book, which is LTR (see document_dir)
    const blue = {bibles: ['heb', 'eng'], story_emphasis: false} as unknown as Blueprint
    const story:ContentPictureStory = {
        type: 'picture_story', id: 's1', title: null, title_subtitle: '', title_icon: null,
        slides: [{id: 'sl1', image: null, mode: 'passage', book: 'gen', start_chapter: 1,
            start_verse: null, end_chapter: 1, end_verse: null, doc: {type: 'doc', content: []}}],
    }

    // Stub the plain-text fetch so each translation either has the book or lacks it
    const stub_books = (texts:Record<string, string|null>) => {
        vi.spyOn(content as never, 'fetch_book_txt').mockImplementation(
            ((bible:string) => Promise.resolve(texts[bible] === null ? null
                : {get_passage_from_ref: () => texts[bible]})) as never)
    }

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('scopes the primary translation\'s text to its own direction', async () => {
        stub_books({heb: 'בראשית', eng: 'In the beginning'})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (content as any).gen_picture_story_item(blue, story, resources)
        expect(result.slides[0].body).toBe('#[#set text(dir: rtl)\nבראשית\n]')
    })

    it('leaves the body empty when the primary translation lacks the book', async () => {
        // An empty body is what makes the slide image-only (see content_picture_story.ts)
        stub_books({heb: null, eng: 'In the beginning'})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (content as any).gen_picture_story_item(blue, story, resources)
        expect(result.slides[0].body).toBe('')
    })
})


describe('BibleContent before init', () => {

    it('refuses to hand out the collection until init() has fetched it', () => {
        const content = new BibleContent({endpoint: 'http://example.invalid/'})
        expect(() => content.collection).toThrow('init() must be awaited')
    })
})


describe('BibleContent.resolve', () => {

    const ENDPOINT = 'http://content.invalid/'
    // A PNG's magic number, enough for the image cache to name the format
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // A raw icon, which resolve_icon recolors without fetching
    const ICON = '<svg viewBox="0 0 1 1"><path fill="currentColor"/></svg>'
    // An icon id that can never resolve (an unknown builtin throws without touching the network)
    const BAD_ICON = 'builtin:no-such-icon'

    // Which books each translation has: eng_b lacks Exodus, neither has Leviticus
    const AVAILABLE:Record<string, string[]> = {eng_a: ['gen', 'exo', 'psa'], eng_b: ['gen', 'psa']}
    const NAMES:Record<string, string> = {gen: 'Genesis', exo: 'Exodus', psa: 'Psalms', lev: 'Leviticus'}

    // A fake collection: each book's passage text names its translation and format, and the
    // Typst format carries a verse marker for study notes to attach to
    const fetch_book = vi.fn((bible:string, book:string, format:string) => Promise.resolve({
        get_passage_from_ref: () => format === 'typst'
            ? `#ch(1)\n#vn(1)${bible} ${book} text.`
            : `${bible} ${book} prose.`,
    }))
    const collection = {
        get_resources: () => ({
            eng_a: make_resource({id: 'eng_a'}),
            eng_b: make_resource({id: 'eng_b'}),
        }),
        get_books: (bible:string) => Object.fromEntries(Object.entries(NAMES).map(
            ([book, name]) => [book, {name, available: AVAILABLE[bible]?.includes(book) ?? false}])),
        fetch_book,
        reference_to_string: () => 'Genesis 1',
    } as unknown as BibleCollection

    // The network: a study notes file for Genesis, and any .png url as an image
    const fetch_mock = vi.fn((url:string) => {
        if (url === `${ENDPOINT}notes/eng_tyndale/typst/gen.json`
                || url === `${ENDPOINT}notes/spa_notas/typst/gen.json`) {
            return Promise.resolve(new Response(JSON.stringify({
                notes_id: 'eng_tyndale', book: 'gen', ranges: [],
                verses: {'1': {'1': 'A study note'}},
            })))
        }
        if (url.endsWith('.png')) {
            return Promise.resolve(new Response(PNG, {headers: {'content-type': 'image/png'}}))
        }
        return Promise.resolve(new Response('', {status: 404}))
    })

    const make_passage = (overrides:Partial<ContentPassage> = {}):ContentPassage => ({
        type: 'passage', id: 'p1', book: 'gen', start_chapter: 1, start_verse: null,
        end_chapter: 1, end_verse: null, title: null, title_subtitle: '', title_icon: null,
        image: null, ...overrides,
    })

    // A story slide of one chapter of a book, or a free-text slide when no book is given
    const make_slide = (id:string, book:string|null, image_url?:string) => ({
        id, image: image_url ? {url: image_url} : null, mode: book ? 'passage' : 'text',
        book: book ?? '', start_chapter: book ? 1 : null, start_verse: null,
        end_chapter: book ? 1 : null, end_verse: null,
        doc: {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: 'Free slide text'}]}]},
    }) as ContentPictureStory['slides'][number]

    const make_story = (slides:ContentPictureStory['slides']):ContentPictureStory => ({
        type: 'picture_story', id: 's1', title: 'A story', title_subtitle: '', title_icon: null,
        slides,
    })

    // A fresh instance per test, so nothing is served from another test's caches
    const make_content = () => new BibleContent({collection, endpoint: ENDPOINT})

    beforeEach(() => {
        fetch_book.mockClear()
        fetch_mock.mockClear()
        vi.stubGlobal('fetch', fetch_mock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('skips a translation lacking the book, and keeps one empty entry if all do', async () => {
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'], content: [
            make_passage({id: 'p1', book: 'exo'}),
            make_passage({id: 'p2', book: 'lev'}),
        ]})
        const request = await make_content().resolve(blue)
        const [exodus, leviticus] = request.content as TypstPassage[]
        expect(exodus!.bibles.map(bible => bible.content)).toEqual(['#ch(1)\n#vn(1)eng_a exo text.'])
        // The renderer always gets something to work with
        expect(leviticus!.bibles).toEqual([{content: ''}])
    })

    it('reports fetch progress as i of the distinct books not yet cached', async () => {
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'], content: [
            make_passage({book: 'gen'}),
            // A story's passage slides count for both translations too
            make_story([make_slide('sl1', 'psa'), make_slide('sl2', null)]),
        ]})
        const progress = vi.fn()
        await make_content().resolve(blue, undefined, progress)
        const fetches = progress.mock.calls.map(([event]) => event)
            .filter(event => event.stage === 'fetch')
        expect(fetches).toEqual([
            {stage: 'fetch', i: 1, total: 4, label: 'Genesis'},
            {stage: 'fetch', i: 2, total: 4, label: 'Genesis'},
            {stage: 'fetch', i: 3, total: 4, label: 'Psalms'},
            {stage: 'fetch', i: 4, total: 4, label: 'Psalms'},
        ])
    })

    it('counts a book a passage and a story slide both use as two downloads', async () => {
        // The passage takes Genesis as Typst, the slide as plain text: two downloads, and
        // Exodus only from eng_a (eng_b lacks it, so it never downloads there)
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'], content: [
            make_passage({book: 'gen'}),
            make_passage({id: 'p2', book: 'exo'}),
            make_story([make_slide('sl1', 'gen')]),
        ]})
        const progress = vi.fn()
        await make_content().resolve(blue, undefined, progress)
        const fetches = progress.mock.calls.map(([event]) => event)
            .filter(event => event.stage === 'fetch')
        expect(fetches.map(event => [event.i, event.total]))
            .toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
    })

    it('puts a title page before each passage and story in titlepage mode', async () => {
        const blue = make_blueprint({passage_title: 'titlepage', titlepage_color_icon: '#123456',
            content: [
                make_passage({title: 'Creation', title_icon: ICON}),
                {...make_story([make_slide('sl1', 'gen')]), title_icon: BAD_ICON},
            ]})
        const request = await make_content().resolve(blue)
        expect(request.content.map(item => item.type))
            .toEqual(['title', 'passage', 'title', 'picture_story'])
        const [creation, , story] = request.content as TypstTitlePage[]
        expect(creation).toMatchObject({title: 'Creation'})
        expect(creation!.icon).toContain('fill="#123456"')
        // An icon that can't be resolved drops out rather than breaking the document
        expect(story).toMatchObject({title: 'A story', icon: null})
        // The passage itself then carries no inline heading
        expect((request.content[1] as TypstPassage).passage_title).toBe(null)
    })

    it('resolves an inline heading\'s icon, dropping one that fails', async () => {
        const blue = make_blueprint({passage_title: 'heading', titlepage_color_icon: '#abcdef',
            content: [
                make_passage({id: 'p1', title: 'With icon', title_icon: ICON}),
                make_passage({id: 'p2', title: 'Broken icon', title_icon: BAD_ICON}),
            ]})
        const [good, bad] = (await make_content().resolve(blue)).content as TypstPassage[]
        expect(good!.passage_title).toBe('With icon')
        expect(good!.passage_icon).toContain('fill="#abcdef"')
        expect(bad!.passage_title).toBe('Broken icon')
        expect(bad!.passage_icon).toBe(null)
    })

    it('collects passage and story slide images into the request\'s assets', async () => {
        const blue = make_blueprint({content: [
            make_passage({id: 'p1', image: {url: 'https://img.invalid/resolve_passage.png'}
                } as Partial<ContentPassage>),
            make_story([make_slide('sl1', null, 'https://img.invalid/resolve_slide.png')]),
        ]})
        const request = await make_content().resolve(blue)
        expect(Object.keys(request.assets).sort())
            .toEqual(['passage_img_p1.png', 'passage_img_s1_0.png'])
        expect(request.assets['passage_img_p1.png']).toEqual(PNG)
    })

    it('renders a story\'s free-text slide from its own document, with no second body', async () => {
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'],
            content: [make_story([make_slide('sl1', null)])]})
        const [story] = (await make_content().resolve(blue)).content as TypstPictureStory[]
        expect(story!.slides[0]!.body).toContain('Free slide text')
        expect(story!.slides[0]!.body2).toBe(null)
    })

    it('splices study notes into the primary translation only, and turns footnotes off',
            async () => {
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'], notes: 'eng_tyndale',
            show_footnotes: true, content: [make_passage()]})
        const request = await make_content().resolve(blue)
        const [passage] = request.content as TypstPassage[]
        expect(passage!.bibles[0]!.content).toContain('#studynote[#strong[1:1] A study note]')
        expect(passage!.bibles[1]!.content).not.toContain('studynote')
        expect(passage!.show_footnotes).toBe(false)
        // Notes in the document's own language need no locale of their own
        expect(request.typography.notes_lang).toBe(null)
    })

    it('reads an unlisted notes resource\'s language from its id', async () => {
        // An injected collection carries no notes metadata, so `spa_` is all there is to go on
        const blue = make_blueprint({bibles: ['eng_a'], notes: 'spa_notas', content: [make_passage()]})
        const request = await make_content().resolve(blue)
        expect(request.typography.notes_lang).toBe('es')
        expect(request.typography.notes_dir).toBe(null)
    })

    it('caches a notes file, but retries one that failed to download', async () => {
        const content = make_content()
        const blue = make_blueprint({bibles: ['eng_a'], notes: 'eng_tyndale',
            content: [make_passage()]})
        const notes_calls = () => fetch_mock.mock.calls
            .filter(([url]) => url.includes('/notes/')).length

        // A network failure degrades to no notes, without remembering the miss
        fetch_mock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
        const offline = await content.resolve(blue)
        expect((offline.content[0] as TypstPassage).bibles[0]!.content).not.toContain('studynote')

        // So the next resolve fetches again, and the one after is served from the cache
        const online = await content.resolve(blue)
        expect((online.content[0] as TypstPassage).bibles[0]!.content).toContain('studynote')
        await content.resolve(blue)
        expect(notes_calls()).toBe(2)
    })

    it('prefetches each translation\'s copy of every distinct book once', async () => {
        const content = make_content()
        const blue = make_blueprint({bibles: ['eng_a', 'eng_b'], content: [
            make_passage({id: 'p1', book: 'gen'}),
            make_passage({id: 'p2', book: 'gen', start_chapter: 2, end_chapter: 2}),
            make_passage({id: 'p3', book: 'exo'}),
        ]})
        await content.prefetch(blue)
        // eng_b has no Exodus, so there's nothing to fetch for it
        expect(fetch_book.mock.calls.map(call => call.slice(0, 2)).sort())
            .toEqual([['eng_a', 'exo'], ['eng_a', 'gen'], ['eng_b', 'gen']])
        // Resolving afterwards needs nothing more
        await content.resolve(blue)
        expect(fetch_book).toHaveBeenCalledTimes(3)
    })
})


describe('BibleContent.fetch_book_txt', () => {

    const fetch_book = vi.fn(() => Promise.resolve({get_passage_from_ref: () => 'prose'}))
    const collection = {
        get_books: () => ({gen: {name: 'Genesis', available: true},
            exo: {name: 'Exodus', available: false}}),
        fetch_book,
    } as unknown as BibleCollection

    beforeEach(() => {
        fetch_book.mockClear()
    })

    it('reports through the instance\'s own progress callback when given none', async () => {
        const on_progress = vi.fn()
        const content = new BibleContent({collection, on_progress})
        await content.fetch_book_txt('eng_a', 'gen')
        expect(on_progress).toHaveBeenCalledWith({stage: 'fetch', label: 'Genesis'})
        expect(fetch_book).toHaveBeenCalledWith('eng_a', 'gen', 'txt')
    })

    it('serves a book from the cache, and null for one the translation lacks', async () => {
        const content = new BibleContent({collection})
        const first = await content.fetch_book_txt('eng_a', 'gen')
        expect(await content.fetch_book_txt('eng_a', 'gen')).toBe(first)
        expect(await content.fetch_book_txt('eng_a', 'exo')).toBe(null)
        expect(fetch_book).toHaveBeenCalledTimes(1)
    })
})
