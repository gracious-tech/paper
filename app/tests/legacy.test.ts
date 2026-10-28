// The HTML export of a design from the previous version of Paper Bible — everything recoverable
// from an old IndexedDB item, as a self-contained page the user saves to disk

import {describe, it, expect} from 'vitest'

import {build_legacy_html} from '@/legacy/legacy'

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
