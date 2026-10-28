// The HTML export of a design from the previous version of Paper Bible — everything recoverable
// from an old IndexedDB item, as a self-contained page the user saves to disk

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {build_legacy_html, download_legacy_html, legacy, probe_legacy_data} from '@/legacy/legacy'

import type {LegacyItem, OldBlueprint, OldContentItem, OldContentPassage}
    from '@/legacy/legacy'


// An old item holding the given content (only the fields the export reads matter)
function item(content:OldContentItem[], overrides:Partial<LegacyItem> = {}):LegacyItem{
    return {
        id: 'r1',
        is_draft: false,
        title: 'My Bible',
        created: null,
        pages: null,
        pdf_url: null,
        blueprint: {title: 'My Bible', content} as OldBlueprint,
        ...overrides,
    }
}


// An old passage item, whole-book unless a range is given
function passage(book:string, range:Partial<OldContentPassage> = {}):OldContentPassage{
    return {type: 'passage', id: 'p', book, start_chapter: null, start_verse: null,
        end_chapter: null, end_verse: null, title: true, ...range}
}


// The heading a single passage item exports as
function passage_heading(value:OldContentPassage):string{
    return /<h2>(.*)<\/h2>/.exec(build_legacy_html(item([value])))?.[1] ?? ''
}


describe('build_legacy_html', () => {

    // The page wrapper: a full document titled after the item, with the footer
    it('is a complete document titled after the item', () => {
        const html = build_legacy_html(item([]))
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
        expect(html).toContain('<meta charset="utf-8">')
        expect(html).toContain('<title>My Bible</title>')
        expect(html).toContain('<h1>My Bible</h1>')
        expect(html).toContain('Saved from the previous version of paper.bible')
    })

    // An item with no content says so, rather than exporting an empty page
    it('notes when there was no content', () => {
        expect(build_legacy_html(item([]))).toContain('This document had no content.')
        // An old draft could be missing its content array entirely
        const bare = item([])
        bare.blueprint = {title: 'x'} as OldBlueprint
        expect(build_legacy_html(bare)).toContain('This document had no content.')
    })

    // The meta line: when it was made, its length, and whether it was a draft
    it('lists what is known about the item, and nothing when nothing is', () => {
        const created = new Date(2024, 0, 2, 3, 4)
        const html = build_legacy_html(item([], {created, pages: 120}))
        expect(html).toContain(`Created ${created.toLocaleString()} — 120 pages`)
        expect(build_legacy_html(item([], {is_draft: true})))
            .toContain('Unsaved draft (was never made into a PDF)')
        expect(build_legacy_html(item([]))).not.toContain('class="meta"')
    })

    // Title pages keep their wording only, the subtitle when there is one
    it('renders title pages', () => {
        const title = {type: 'title', id: 't', title: 'The Gospels', subtitle: 'For Sam',
            icon: null, pattern: 'x', color_primary: '#000', color_secondary: '#fff',
            alone: false} as const
        const html = build_legacy_html(item([title]))
        expect(html).toContain('Title page')
        expect(html).toContain('<h2>The Gospels</h2>')
        expect(html).toContain('<h3>For Sam</h3>')
        expect(build_legacy_html(item([{...title, subtitle: ''}]))).not.toContain('<h3>')
    })

    // Custom pages keep their name and the user's own HTML, with the old placeholder explained
    it('renders custom pages, explaining the auto-copyright placeholder', () => {
        const html = build_legacy_html(item([{type: 'custom', id: 'c', name: 'Preface',
            html: '<p>Hello <b>there</b></p>AUTO-COPYRIGHT', position: 'top'}]))
        expect(html).toContain('Custom text')
        expect(html).toContain('<h2>Preface</h2>')
        expect(html).toContain('<div class="custom"><p>Hello <b>there</b></p><em>[copyright')
        expect(html).not.toContain('AUTO-COPYRIGHT')
    })

    // Every item is exported, in order
    it('keeps the content in its original order', () => {
        const html = build_legacy_html(item([
            {type: 'custom', id: 'a', name: 'First', html: '', position: 'top'},
            passage('jhn'),
            {type: 'custom', id: 'b', name: 'Last', html: '', position: 'bottom'},
        ]))
        const order = ['First', 'John', 'Last'].map(text => html.indexOf(text))
        expect(order.every(at => at >= 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

})


describe('build_legacy_html escaping', () => {

    // The text the user typed in the old app, which must come out as text, not markup
    const hostile = '<script>alert("x")</script> & <img src=x onerror=y>'
    const escaped = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x '
        + 'onerror=y&gt;'

    // The item's own title, in both the <title> and the heading
    it('escapes the item title', () => {
        const html = build_legacy_html(item([], {title: hostile}))
        expect(html).toContain(`<title>${escaped}</title>`)
        expect(html).toContain(`<h1>${escaped}</h1>`)
        expect(html).not.toContain('<script>')
    })

    // Title page wording and custom page names
    it('escapes title pages and custom page names', () => {
        const html = build_legacy_html(item([
            {type: 'title', id: 't', title: hostile, subtitle: hostile, icon: null,
                pattern: 'x', color_primary: '#000', color_secondary: '#fff', alone: false},
            {type: 'custom', id: 'c', name: hostile, html: '', position: 'top'},
        ]))
        expect(html).toContain(`<h2>${escaped}</h2>`)
        expect(html).toContain(`<h3>${escaped}</h3>`)
        expect(html).not.toContain('<script>')
    })

    // A book code the reference library doesn't know is shown as-is (upper-cased), so escaped too
    it('escapes an unknown book code', () => {
        expect(passage_heading(passage('<b>'))).toBe('&lt;B&gt; (whole book)')
    })

})


describe('passage references', () => {

    // No chapter at either end means the whole book
    it('names a whole book', () => {
        expect(passage_heading(passage('gen'))).toBe('Genesis (whole book)')
    })

    // A single chapter, or a single verse, has no range
    it('shows a lone start, or an end identical to it, without a range', () => {
        expect(passage_heading(passage('gen', {start_chapter: 3}))).toBe('Genesis 3')
        expect(passage_heading(passage('gen', {start_chapter: 3, start_verse: 16})))
            .toBe('Genesis 3:16')
        expect(passage_heading(passage('gen', {start_chapter: 3, start_verse: 16,
            end_chapter: 3, end_verse: 16}))).toBe('Genesis 3:16')
    })

    // Ranges between chapters and verses, in any mix
    it('shows ranges', () => {
        expect(passage_heading(passage('gen', {start_chapter: 1, start_verse: 1,
            end_chapter: 3, end_verse: 24}))).toBe('Genesis 1:1 – 3:24')
        expect(passage_heading(passage('1jn', {start_chapter: 1, end_chapter: 2})))
            .toBe('1 John 1 – 2')
        expect(passage_heading(passage('gen', {start_chapter: 1, end_chapter: 2,
            end_verse: 3}))).toBe('Genesis 1 – 2:3')
    })

    // Only an end means from the start of the book, written as precisely as the end
    it('starts an end-only range at the book\'s beginning', () => {
        expect(passage_heading(passage('gen', {end_chapter: 4}))).toBe('Genesis 1 – 4')
        expect(passage_heading(passage('gen', {end_chapter: 4, end_verse: 5})))
            .toBe('Genesis 1:1 – 4:5')
        expect(passage_heading(passage('gen', {end_chapter: 1}))).toBe('Genesis 1')
    })

    // A verse without its chapter can't be shown, so it's dropped
    it('ignores a verse with no chapter', () => {
        expect(passage_heading(passage('gen', {start_verse: 5}))).toBe('Genesis (whole book)')
    })

})


// A minimal IndexedDB request: settles on the next tick, as the real one does
function fake_request<T>(outcome:{result?:T|undefined, error?:Error|undefined,
        blocked?:boolean|undefined}){
    const request = {result: outcome.result, error: outcome.error ?? null} as {
        result:T|undefined, error:Error|null, onsuccess?:() => void, onerror?:() => void,
        onblocked?:() => void}
    setTimeout(() => {
        if (outcome.blocked){
            request.onblocked?.()
        } else if (outcome.error){
            request.onerror?.()
        } else {
            request.onsuccess?.()
        }
    })
    return request
}


// The old database as IndexedDB would open it: which stores exist, what they hold, and whether
// reading them fails
interface FakeDatabase {
    stores:string[]
    creations?:unknown[]
    draft?:unknown
    read_error?:boolean
}


describe('probe_legacy_data', () => {

    // What the probe did to the fake IndexedDB
    let closed:number
    let deleted:string[]

    // Stub indexedDB.open() with the given outcome
    function stub_indexed_db(open:{db?:FakeDatabase, error?:boolean, blocked?:boolean}){
        closed = 0
        deleted = []
        const db = open.db && {
            objectStoreNames: {contains: (name:string) => open.db!.stores.includes(name)},
            close: () => {
                closed += 1
            },
            transaction: (names:string[], mode:string) => {
                expect(mode).toBe('readonly')
                expect(names).toEqual(['creations', 'config'])
                return {objectStore: (name:string) => ({
                    getAll: () => fake_request(open.db!.read_error
                        ? {error: new Error('corrupt')} : {result: open.db!.creations ?? []}),
                    get: (key:string) => {
                        expect([name, key]).toEqual(['config', 'draft'])
                        return fake_request({result: open.db!.draft})
                    },
                })}
            },
        }
        vi.stubGlobal('indexedDB', {
            open: (name:string, version?:number) => {
                // Opened with no version, so no upgrade handler can ever touch the old data
                expect([name, version]).toEqual(['paper_bible', undefined])
                return fake_request({result: db, ...open.error && {error: new Error('no idb')},
                    ...open.blocked && {blocked: true}})
            },
            deleteDatabase: (name:string) => {
                deleted.push(name)
            },
        })
    }

    // An old creation as the previous app stored it
    const creation = (request_id:string, created:Date|undefined, extra:object = {}) => ({
        request_id, created, pages: 12, creation_id: `c_${request_id}`,
        blueprint: {title: `Title ${request_id}`, content: []}, ...extra,
    })

    beforeEach(() => {
        legacy.available = false
        legacy.items = []
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // Private tabs and some webviews have no usable IndexedDB — the button just stays hidden
    it('stays hidden when the database can\'t be opened', async () => {
        stub_indexed_db({error: true})
        await probe_legacy_data()
        expect(legacy.available).toBe(false)
        stub_indexed_db({blocked: true})
        await probe_legacy_data()
        expect(legacy.available).toBe(false)
    })

    // Opening a database that doesn't exist creates it, so the probe deletes it again
    it('removes the empty database it created for someone who never used the old app', async () => {
        stub_indexed_db({db: {stores: []}})
        await probe_legacy_data()
        expect(closed).toBe(1)
        expect(deleted).toEqual(['paper_bible'])
        expect(legacy.available).toBe(false)
    })

    // A store that can't be read offers nothing, and closes the database either way
    it('offers nothing when the stores can\'t be read', async () => {
        stub_indexed_db({db: {stores: ['creations', 'config'], read_error: true}})
        await probe_legacy_data()
        expect(closed).toBe(1)
        expect(deleted).toEqual([])
        expect(legacy.available).toBe(false)
    })

    // Creations newest first, each with its old PDF's public url, after the unsaved draft
    it('offers the draft first, then creations newest first with their PDFs', async () => {
        stub_indexed_db({db: {
            stores: ['creations', 'config'],
            creations: [
                creation('old', new Date('2024-01-01')),
                creation('new', new Date('2025-06-01')),
                // No date sorts last, no PDF id has no link, a blank title is "Untitled"
                creation('undated', undefined, {creation_id: null,
                    blueprint: {title: '  ', content: []}}),
                // A creation without a blueprint has nothing to recover
                {request_id: 'empty', created: new Date(), pages: 1, creation_id: 'x'},
            ],
            draft: {key: 'draft', value: {title: '', content: [{type: 'custom'}]}},
        }})
        await probe_legacy_data()
        expect(closed).toBe(1)
        expect(legacy.available).toBe(true)
        expect(legacy.items.map(item => [item.id, item.is_draft, item.title, item.pdf_url]))
            .toEqual([
                ['draft', true, 'Unsaved draft', null],
                ['new', false, 'Title new',
                    'https://paper-bible-prod.s3.us-west-2.amazonaws.com/creations/c_new.pdf'],
                ['old', false, 'Title old',
                    'https://paper-bible-prod.s3.us-west-2.amazonaws.com/creations/c_old.pdf'],
                ['undated', false, 'Untitled', null],
            ])
        expect(legacy.items[1]!.created).toEqual(new Date('2025-06-01'))
        expect(legacy.items[3]!.created).toBe(null)
    })

    // A draft with no content (the old app's blank state) isn't worth offering
    it('skips a draft with no content, and shows nothing when nothing is left', async () => {
        stub_indexed_db({db: {stores: ['creations', 'config'], creations: [],
            draft: {key: 'draft', value: {title: 'x'}}}})
        await probe_legacy_data()
        expect(legacy.items).toEqual([])
        expect(legacy.available).toBe(false)
    })

})


describe('download_legacy_html', () => {

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    // The export is handed over as a file named after the item, and its blob released later
    it('saves the export under a safe filename, then releases the blob', async () => {
        vi.useFakeTimers()
        const anchor = {href: '', download: '', click: vi.fn(), remove: vi.fn()}
        const appended:unknown[] = []
        vi.stubGlobal('document', {
            createElement: (tag:string) => {
                expect(tag).toBe('a')
                return anchor
            },
            body: {appendChild: (node:unknown) => appended.push(node)},
        })
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:legacy')
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

        download_legacy_html(item([], {title: 'Psalms: 1/2?'}))
        expect(anchor.href).toBe('blob:legacy')
        expect(anchor.download).toBe('Psalms- 1-2- (old paper.bible).html')
        expect(appended).toEqual([anchor])
        expect(anchor.click).toHaveBeenCalledOnce()
        expect(anchor.remove).toHaveBeenCalledOnce()

        // The blob holds the export itself
        const blob = create.mock.calls[0]![0] as Blob
        expect(blob.type).toBe('text/html')
        expect(await blob.text()).toContain('<title>Psalms: 1/2?</title>')

        // Released only once the browser has had time to start the download
        expect(revoke).not.toHaveBeenCalled()
        vi.advanceTimersByTime(10000)
        expect(revoke).toHaveBeenCalledWith('blob:legacy')
        create.mockRestore()
        revoke.mockRestore()
    })

    // A title of nothing but unsafe characters still gets a usable name
    it('falls back to a generic name when nothing of the title survives', () => {
        const anchor = {href: '', download: '', click: vi.fn(), remove: vi.fn()}
        vi.stubGlobal('document', {createElement: () => anchor, body: {appendChild: vi.fn()}})
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
        download_legacy_html(item([], {title: '  '}))
        expect(anchor.download).toBe('bible (old paper.bible).html')
        create.mockRestore()
    })

})
