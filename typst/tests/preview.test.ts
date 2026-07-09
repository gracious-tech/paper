
import {describe, it, expect} from 'vitest'

import {truncate_for_preview, PREVIEW_CHAR_LIMIT} from '../src/preview.js'
import {make_request, make_passage, make_title} from './fixtures.js'

import type {TypstPassage, TypstCustomPage} from '../src/types.js'


// Messages passed in place of the app's translated strings
const MESSAGES = {title: 'End of preview', detail: 'Create document to see the rest'}


// Build a passage whose content is `paragraphs` numbered paragraph blocks separated by blank
// lines, so tests can tell which part of the document survived truncation
function make_long_passage(paragraphs:number, prefix = 'para'):TypstPassage {
    const blocks = []
    for (let i = 0; i < paragraphs; i++) {
        blocks.push(`${prefix}-${i} ` + 'x'.repeat(95))
    }
    return make_passage({bibles: [{content: blocks.join('\n\n')}]})
}


describe('truncate_for_preview', () => {

    it('returns small documents untouched', () => {
        const request = make_request({content: [make_title(), make_long_passage(10)]})
        const result = truncate_for_preview(request, 'start', MESSAGES)
        expect(result.truncated).toBe(false)
        expect(result.request).toBe(request)
    })

    it('truncates a large document and appends an end-of-preview page', () => {
        // ~100 chars per paragraph, so 3x the limit worth of paragraphs
        const paragraphs = Math.ceil(PREVIEW_CHAR_LIMIT * 3 / 100)
        const request = make_request({content: [make_long_passage(paragraphs)]})
        const result = truncate_for_preview(request, 'start', MESSAGES)
        expect(result.truncated).toBe(true)

        // Passage kept but cut down to roughly the budget
        const passage = result.request.content[0] as TypstPassage
        const content = passage.bibles[0]!.content
        expect(content.length).toBeLessThan(PREVIEW_CHAR_LIMIT * 1.1)
        expect(content.startsWith('para-0 ')).toBe(true)

        // End-of-preview page appended as the final item
        const last = result.request.content.at(-1) as TypstCustomPage
        expect(last.type).toBe('custom')
        expect(last.content).toContain('End of preview')
        expect(last.content).toContain('Create document to see the rest')
    })

    it('shows the requested section of the document', () => {
        const paragraphs = Math.ceil(PREVIEW_CHAR_LIMIT * 3 / 100)
        const request = make_request({content: [make_long_passage(paragraphs)]})

        // Middle: neither the first nor the last paragraph, and still cut short at the end
        const middle = truncate_for_preview(request, 'middle', MESSAGES)
        const middle_content = (middle.request.content[0] as TypstPassage).bibles[0]!.content
        expect(middle_content).not.toContain('para-0 ')
        expect(middle_content).not.toContain(`para-${paragraphs - 1} `)
        expect((middle.request.content.at(-1) as TypstCustomPage).type).toBe('custom')

        // End: reaches the document's last paragraph, so no end-of-preview page
        const end = truncate_for_preview(request, 'end', MESSAGES)
        const end_content = (end.request.content[0] as TypstPassage).bibles[0]!.content
        expect(end_content).toContain(`para-${paragraphs - 1} `)
        expect(end.request.content.at(-1)!.type).toBe('passage')
    })

    it('drops whole items outside the window', () => {
        const paragraphs = Math.ceil(PREVIEW_CHAR_LIMIT * 2 / 100)
        const request = make_request({content: [
            make_title(),
            make_long_passage(paragraphs, 'first'),
            make_long_passage(paragraphs, 'second'),
        ]})

        // Start window: keeps the title and the first passage only
        const start = truncate_for_preview(request, 'start', MESSAGES)
        expect(start.request.content[0]!.type).toBe('title')
        const kept_passages = start.request.content.filter(
            (item):item is TypstPassage => item.type === 'passage')
        expect(kept_passages.length).toBe(1)
        expect(kept_passages[0]!.bibles[0]!.content).toContain('first-0 ')

        // End window: the title and first passage fall away
        const end = truncate_for_preview(request, 'end', MESSAGES)
        expect(end.request.content.every(item => item.type !== 'title')).toBe(true)
        const end_passages = end.request.content.filter(
            (item):item is TypstPassage => item.type === 'passage')
        expect(end_passages.length).toBe(1)
        expect(end_passages[0]!.bibles[0]!.content).toContain(`second-${paragraphs - 1} `)
    })

    it('cuts at paragraph boundaries so blocks stay whole', () => {
        const paragraphs = Math.ceil(PREVIEW_CHAR_LIMIT * 3 / 100)
        const request = make_request({content: [make_long_passage(paragraphs)]})
        const result = truncate_for_preview(request, 'middle', MESSAGES)
        const content = (result.request.content[0] as TypstPassage).bibles[0]!.content

        // Every kept block is a complete paragraph (marker at start, full padding retained)
        for (const block of content.split('\n\n')) {
            expect(block).toMatch(/^para-\d+ x{95}$/)
        }
    })

})
