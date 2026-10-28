
import {describe, it, expect} from 'vitest'

import {truncate_for_preview, PREVIEW_CHAR_LIMIT, ESTIMATE_CHAR_LIMIT} from '../src/preview.js'
import {make_request, make_passage, make_title, make_custom} from './fixtures.js'

import type {TypstPassage} from '../src/types.js'


// Build a passage whose content is `paragraphs` numbered paragraph blocks separated by blank
// lines (~105 chars each), so tests can tell which part of the document survived truncation
function make_book(paragraphs:number, prefix:string):TypstPassage {
    const blocks = []
    for (let i = 0; i < paragraphs; i++) {
        blocks.push(`${prefix}-${i} ` + 'x'.repeat(95))
    }
    return make_passage({bibles: [{content: blocks.join('\n\n')}], progress_label: prefix})
}


// First token of a kept passage's markup, e.g. 'gen' from 'gen-0 xxx...'
function marker(item:TypstPassage):string {
    return item.bibles[0]!.content.split('-')[0]!
}


describe('truncate_for_preview', () => {

    it('returns small documents untouched', () => {
        const request = make_request({content: [make_title(), make_book(10, 'gen')]})
        const result = truncate_for_preview(request, 'start')
        expect(result.truncated).toBe(false)
        expect(result.request).toBe(request)
        expect(result.dropped_before).toBe(false)
        expect(result.dropped_after).toBe(false)
    })

    it('keeps a large book from its start and clips only the tail', () => {
        const request = make_request({content: [make_book(3000, 'gen')]})
        const result = truncate_for_preview(request, 'start')
        expect(result.truncated).toBe(true)

        const content = (result.request.content[0] as TypstPassage).bibles[0]!.content
        // Start is never disturbed; the end is dropped to roughly the budget
        expect(content.startsWith('gen-0 ')).toBe(true)
        expect(content).not.toContain('gen-2999 ')
        expect(content.length).toBeLessThan(PREVIEW_CHAR_LIMIT * 1.1)

        // Nothing dropped before the window; the tail cut is flagged as dropped_after
        expect(result.dropped_before).toBe(false)
        expect(result.dropped_after).toBe(true)
        expect(result.request.content.every(item => item.type === 'passage')).toBe(true)
    })

    it('clips a book with no blank lines at a chapter start', () => {
        // Poetry (e.g. the KJV's Psalms) separates every line with a single newline, so the
        // whole book is one paragraph block — the cut must fall back to chapter markers
        const chapters = []
        for (let i = 1; i <= 150; i++) {
            chapters.push(`#ch(${i})\n` + `#q(1)[#vn(1)${'x'.repeat(95)}]\n`.repeat(20))
        }
        const book = make_passage({bibles: [{content: chapters.join('')}]})
        const result = truncate_for_preview(make_request({content: [book]}), 'start')

        const content = (result.request.content[0] as TypstPassage).bibles[0]!.content
        expect(content.startsWith('#ch(1)\n')).toBe(true)
        expect(content).not.toContain('#ch(150)')
        expect(content.length).toBeLessThanOrEqual(PREVIEW_CHAR_LIMIT)
        // Cut whole chapters only, so the window ends on a complete line
        expect(content.endsWith(']\n')).toBe(true)
        expect(result.dropped_after).toBe(true)
    })

    it('never cuts inside a study note that spans a blank line', () => {
        // Tyndale's notes end with a blank line before their closing bracket, so a cut at
        // every blank line could end the window inside one ("unclosed delimiter")
        // Where the budget falls depends on the lengths, so try enough of them to land a cut
        // on either side of a note's blank line
        for (let filler = 40; filler < 60; filler++) {
            const verses = []
            for (let i = 1; i <= 2000; i++) {
                verses.push(`#vn(${i})${'x'.repeat(filler)}#studynote[#strong[1:${i}] `
                    + `${'y'.repeat(40)}\n\n]; escaped \\[ text`)
            }
            const book = make_passage({bibles: [{content: verses.join('\n\n')}]})
            const result = truncate_for_preview(make_request({content: [book]}), 'start')

            const content = (result.request.content[0] as TypstPassage).bibles[0]!.content
            expect(content).not.toContain('#vn(2000)')
            expect(content.endsWith('escaped \\[ text')).toBe(true)
        }
    })

    it('never clips the start of a book, even for the middle section', () => {
        // A single over-budget book has nowhere to window to — middle still shows it from
        // its start (clipping the start is the one thing truncation must never do)
        const request = make_request({content: [make_book(3000, 'gen')]})
        const middle = truncate_for_preview(request, 'middle')
        const content = (middle.request.content[0] as TypstPassage).bibles[0]!.content
        expect(content.startsWith('gen-0 ')).toBe(true)
        expect(content).not.toContain('gen-2999 ')
        expect(middle.dropped_before).toBe(false)
        expect(middle.dropped_after).toBe(true)
    })

    it('drops whole leading items and tail-clips the last kept book for the start section', () => {
        const request = make_request({content: [
            make_title(),
            make_book(2000, 'first'),
            make_book(2000, 'second'),
        ]})
        const start = truncate_for_preview(request, 'start')

        expect(start.request.content[0]!.type).toBe('title')
        const passages = start.request.content.filter(
            (item):item is TypstPassage => item.type === 'passage')
        expect(passages.length).toBe(1)
        expect(passages[0]!.bibles[0]!.content.startsWith('first-0 ')).toBe(true)
        expect(passages[0]!.bibles[0]!.content).not.toContain('first-1999 ')

        // 'second' dropped whole -> dropped_after; nothing before the window
        expect(start.dropped_before).toBe(false)
        expect(start.dropped_after).toBe(true)
    })

    it('shows trailing whole books for the end section, without clipping', () => {
        const request = make_request({content: [
            make_book(2000, 'first'),
            make_book(2000, 'second'),
            make_book(300, 'third'),
            make_book(300, 'fourth'),
        ]})
        const end = truncate_for_preview(request, 'end')

        const kept = end.request.content as TypstPassage[]
        expect(kept.map(marker)).toEqual(['third', 'fourth'])
        // First kept book starts intact, last kept book ends intact — no clipping either side
        expect(kept[0]!.bibles[0]!.content.startsWith('third-0 ')).toBe(true)
        expect(kept.at(-1)!.bibles[0]!.content).toContain('fourth-299 ')

        // Content dropped before the window (flagged, no page); nothing after
        expect(end.dropped_before).toBe(true)
        expect(end.dropped_after).toBe(false)
    })

    it('unpins the last item only when the window cuts the document short', () => {
        const request = make_request({last_item_at_end: true, content: [
            make_book(2000, 'first'),
            make_book(2000, 'second'),
        ]})
        // A start window ends mid-document, so whatever it left last isn't the pinned item
        expect(truncate_for_preview(request, 'start').request.last_item_at_end).toBe(false)
        // An end window still finishes on the real last item, so the pin still applies
        expect(truncate_for_preview(request, 'end').request.last_item_at_end).toBe(true)
    })

    it('keeps a large trailing book whole rather than clipping its end', () => {
        const request = make_request({content: [
            make_book(300, 'intro'),
            make_book(3000, 'big'),
        ]})
        const end = truncate_for_preview(request, 'end')

        const kept = end.request.content as TypstPassage[]
        expect(kept.length).toBe(1)
        expect(kept[0]!.bibles[0]!.content.startsWith('big-0 ')).toBe(true)
        expect(kept[0]!.bibles[0]!.content).toContain('big-2999 ')
        expect(end.dropped_before).toBe(true)
        expect(end.dropped_after).toBe(false)
    })

    it('windows onto the middle book for the middle section', () => {
        const books = []
        for (let i = 0; i < 10; i++) {
            books.push(make_book(600, `b${i}`))
        }
        const request = make_request({content: books})
        const middle = truncate_for_preview(request, 'middle')

        const kept = middle.request.content as TypstPassage[]
        const first = marker(kept[0]!)
        // Dropped books on both sides, and the window opens on a whole book's start
        expect(first).not.toBe('b0')
        expect(kept[0]!.bibles[0]!.content.startsWith(`${first}-0 `)).toBe(true)
        expect(middle.dropped_before).toBe(true)
        expect(middle.dropped_after).toBe(true)
    })

    it('reports the kept window weight for page-count scaling', () => {
        const request = make_request({content: [make_book(3000, 'gen')]})
        const result = truncate_for_preview(request, 'start')
        expect(result.total_chars).toBeGreaterThan(PREVIEW_CHAR_LIMIT)
        expect(result.window_chars).toBeLessThanOrEqual(PREVIEW_CHAR_LIMIT * 1.1)
        expect(result.window_chars).toBeLessThan(result.total_chars)
    })

    it('honours a smaller budget, as the estimate-only compile uses', () => {
        const request = make_request({content: [make_book(3000, 'gen')]})
        const result = truncate_for_preview(request, 'start', ESTIMATE_CHAR_LIMIT)
        const content = (result.request.content[0] as TypstPassage).bibles[0]!.content
        expect(content.startsWith('gen-0 ')).toBe(true)
        expect(result.window_chars).toBeLessThan(ESTIMATE_CHAR_LIMIT * 1.01)
        expect(result.window_chars).toBeGreaterThan(ESTIMATE_CHAR_LIMIT * 0.9)
    })

    it('weighs every translation of a bilingual passage, clipping each to its share', () => {
        // Two equal translations of a book each get about half the budget, since the compile
        // typesets both in full
        const one = make_book(3000, 'gen').bibles[0]!
        const two = make_book(3000, 'deu').bibles[0]!
        const request = make_request({content: [make_passage({bibles: [one, two]})]})
        const result = truncate_for_preview(request, 'start')

        const bibles = (result.request.content[0] as TypstPassage).bibles
        expect(result.total_chars).toBe(one.content.length + two.content.length)
        expect(result.window_chars).toBeLessThan(PREVIEW_CHAR_LIMIT * 1.01)
        for (const bible of bibles) {
            expect(bible.content.length).toBeLessThan(PREVIEW_CHAR_LIMIT / 2 * 1.01)
            expect(bible.content.length).toBeGreaterThan(PREVIEW_CHAR_LIMIT / 2 * 0.9)
        }
    })

    // The midpoint falls in the last book, and everything from there to the end fits
    it('runs a middle window to the end when the rest of the document fits', () => {
        const request = make_request({content: [make_book(60, 'gen'), make_book(85, 'exo')]})
        const result = truncate_for_preview(request, 'middle', 10_000)
        expect((result.request.content as TypstPassage[]).map(marker)).toEqual(['exo'])
        expect(result.dropped_before).toBe(true)
        expect(result.dropped_after).toBe(false)
    })

    // A window opening on a custom page would show no Bible text at all
    it('steps a middle window back from a non-passage midpoint to the passage before it', () => {
        const request = make_request({content: [
            make_book(30, 'gen'), make_custom({content: 'c'.repeat(12_000)})]})
        const result = truncate_for_preview(request, 'middle', 10_000)
        expect(result.request.content.map(item => item.type)).toEqual(['passage'])
        expect(marker(result.request.content[0] as TypstPassage)).toBe('gen')
        expect(result.dropped_before).toBe(false)
        expect(result.dropped_after).toBe(true)
    })

    // A trailing blank line is no place to cut, so it changes nothing about the window
    it('clips a book ending in a blank line just as one without', () => {
        const book = make_book(3000, 'gen')
        const trailing = make_passage({bibles: [{content: book.bibles[0]!.content + '\n\n'}]})
        const clipped = (item:TypstPassage) => (truncate_for_preview(
            make_request({content: [item]}), 'start').request.content[0] as TypstPassage)
            .bibles[0]!.content
        expect(clipped(trailing)).toBe(clipped(book))
    })

})
