
import {describe, it, expect} from 'vitest'

import {truncate_for_preview, PREVIEW_CHAR_LIMIT} from '../src/preview.js'
import {make_request, make_passage, make_title} from './fixtures.js'

import type {TypstPassage, TypstCustomPage} from '../src/types.js'


// Messages passed in place of the app's translated strings
const MESSAGES = {
    start_title: 'Start of preview',
    end_title: 'End of preview',
    detail: 'Create document to see the rest',
}


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
        const result = truncate_for_preview(request, 'start', MESSAGES)
        expect(result.truncated).toBe(false)
        expect(result.request).toBe(request)
    })

    it('keeps a large book from its start and clips only the tail', () => {
        const request = make_request({content: [make_book(3000, 'gen')]})
        const result = truncate_for_preview(request, 'start', MESSAGES)
        expect(result.truncated).toBe(true)

        const content = (result.request.content[0] as TypstPassage).bibles[0]!.content
        // Start is never disturbed; the end is dropped to roughly the budget
        expect(content.startsWith('gen-0 ')).toBe(true)
        expect(content).not.toContain('gen-2999 ')
        expect(content.length).toBeLessThan(PREVIEW_CHAR_LIMIT * 1.1)

        // Notice pages are set separately (the pipeline places them after arrangement), never
        // mixed into content. Nothing was dropped before the window, so only the rear notice.
        expect(result.request.content.every(item => item.type === 'passage')).toBe(true)
        expect(result.request.preview_front).toBeUndefined()
        const rear = result.request.preview_rear as TypstCustomPage
        expect(rear.type).toBe('custom')
        expect(rear.content).toContain('End of preview')
        expect(rear.content).toContain('Create document to see the rest')
    })

    it('never clips the start of a book, even for the middle section', () => {
        // A single over-budget book has nowhere to window to — middle still shows it from
        // its start (clipping the start is the one thing truncation must never do)
        const request = make_request({content: [make_book(3000, 'gen')]})
        const middle = truncate_for_preview(request, 'middle', MESSAGES)
        const content = (middle.request.content[0] as TypstPassage).bibles[0]!.content
        expect(content.startsWith('gen-0 ')).toBe(true)
        expect(content).not.toContain('gen-2999 ')
        expect(middle.request.preview_front).toBeUndefined()
        expect(middle.request.preview_rear).toBeDefined()
    })

    it('drops whole leading items and tail-clips the last kept book for the start section', () => {
        const request = make_request({content: [
            make_title(),
            make_book(2000, 'first'),
            make_book(2000, 'second'),
        ]})
        const start = truncate_for_preview(request, 'start', MESSAGES)

        expect(start.request.content[0]!.type).toBe('title')
        const passages = start.request.content.filter(
            (item):item is TypstPassage => item.type === 'passage')
        expect(passages.length).toBe(1)
        expect(passages[0]!.bibles[0]!.content.startsWith('first-0 ')).toBe(true)
        expect(passages[0]!.bibles[0]!.content).not.toContain('first-1999 ')

        // 'second' dropped whole -> rear notice; nothing before the window -> no front notice
        expect(start.request.preview_front).toBeUndefined()
        expect(start.request.preview_rear).toBeDefined()
    })

    it('shows trailing whole books for the end section, without clipping', () => {
        const request = make_request({content: [
            make_book(2000, 'first'),
            make_book(2000, 'second'),
            make_book(300, 'third'),
            make_book(300, 'fourth'),
        ]})
        const end = truncate_for_preview(request, 'end', MESSAGES)

        const kept = end.request.content as TypstPassage[]
        expect(kept.map(marker)).toEqual(['third', 'fourth'])
        // First kept book starts intact, last kept book ends intact — no clipping either side
        expect(kept[0]!.bibles[0]!.content.startsWith('third-0 ')).toBe(true)
        expect(kept.at(-1)!.bibles[0]!.content).toContain('fourth-299 ')

        expect(end.request.preview_front).toBeDefined()
        expect(end.request.preview_rear).toBeUndefined()
    })

    it('keeps a large trailing book whole rather than clipping its end', () => {
        const request = make_request({content: [
            make_book(300, 'intro'),
            make_book(3000, 'big'),
        ]})
        const end = truncate_for_preview(request, 'end', MESSAGES)

        const kept = end.request.content as TypstPassage[]
        expect(kept.length).toBe(1)
        expect(kept[0]!.bibles[0]!.content.startsWith('big-0 ')).toBe(true)
        expect(kept[0]!.bibles[0]!.content).toContain('big-2999 ')
        expect(end.request.preview_front).toBeDefined()
        expect(end.request.preview_rear).toBeUndefined()
    })

    it('windows onto the middle book for the middle section', () => {
        const books = []
        for (let i = 0; i < 10; i++) {
            books.push(make_book(600, `b${i}`))
        }
        const request = make_request({content: books})
        const middle = truncate_for_preview(request, 'middle', MESSAGES)

        const kept = middle.request.content as TypstPassage[]
        const first = marker(kept[0]!)
        // Dropped books on both sides, and the window opens on a whole book's start
        expect(first).not.toBe('b0')
        expect(kept[0]!.bibles[0]!.content.startsWith(`${first}-0 `)).toBe(true)
        expect(middle.request.preview_front).toBeDefined()
        expect(middle.request.preview_rear).toBeDefined()
    })

    it('reports the kept window weight for page-count scaling', () => {
        const request = make_request({content: [make_book(3000, 'gen')]})
        const result = truncate_for_preview(request, 'start', MESSAGES)
        expect(result.total_chars).toBeGreaterThan(PREVIEW_CHAR_LIMIT)
        expect(result.window_chars).toBeLessThanOrEqual(PREVIEW_CHAR_LIMIT * 1.1)
        expect(result.window_chars).toBeLessThan(result.total_chars)
    })

})
