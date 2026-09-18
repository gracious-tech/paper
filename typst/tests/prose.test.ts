
import {describe, it, expect} from 'vitest'

import {prose_to_typst} from '../src/prose.js'

import type {PmDoc} from 'pm-to-typst'


// Build a doc from paragraphs, where a missing text is Tiptap's empty (blank line) paragraph
function make_doc(...texts:(string|undefined)[]):PmDoc {
    return {
        type: 'doc',
        content: texts.map(text => text === undefined
            ? {type: 'paragraph'}
            : {type: 'paragraph', content: [{type: 'text', text}]}),
    }
}


describe('prose_to_typst', () => {

    it('drops blank lines by default', () => {
        const result = prose_to_typst(make_doc('one', undefined, 'two'))
        expect(result).not.toContain('#box()')
        expect(result).toBe('one\n\ntwo')
    })

    it('keeps blank lines when asked', () => {
        const result = prose_to_typst(make_doc('one', undefined, 'two'), true)
        // An empty box draws nothing but still occupies a line, unlike an empty paragraph
        expect(result).toBe('one\n\n#box()\n\ntwo')
    })

    it('keeps each of several consecutive blank lines', () => {
        const result = prose_to_typst(make_doc('one', undefined, undefined, 'two'), true)
        expect(result).toBe('one\n\n#box()\n\n#box()\n\ntwo')
    })

    it('leaves non-empty paragraphs to the base renderer', () => {
        const doc:PmDoc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                attrs: {textAlign: 'center'},
                content: [{type: 'text', text: 'centred', marks: [{type: 'bold'}]}],
            }],
        }
        expect(prose_to_typst(doc, true)).toBe('#align(center)[*centred*]')
    })

    it('returns empty markup for a missing doc', () => {
        expect(prose_to_typst(undefined, true)).toBe('')
    })
})
