
import {describe, it, expect} from 'vitest'

import {prose_to_typst, prose_to_text} from '../src/prose.js'

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


describe('prose_to_text', () => {

    it('separates blocks but not inline runs', () => {
        const doc:PmDoc = {
            type: 'doc',
            content: [
                {type: 'heading', attrs: {level: 1}, content: [{type: 'text', text: 'Title'}]},
                {type: 'paragraph', content: [
                    // Split into runs the way a mid-sentence bold would be
                    {type: 'text', text: 'A '},
                    {type: 'text', text: 'bold', marks: [{type: 'bold'}]},
                    {type: 'text', text: ' word.'},
                ]},
            ],
        }
        expect(prose_to_text(doc)).toBe('Title A bold word.')
    })

    it('collapses the whitespace left by blank lines', () => {
        expect(prose_to_text(make_doc('one', undefined, undefined, 'two'))).toBe('one two')
    })

    it('reads text nested inside lists', () => {
        const doc:PmDoc = {
            type: 'doc',
            content: [{
                type: 'bulletList',
                content: [
                    {type: 'listItem', content: [
                        {type: 'paragraph', content: [{type: 'text', text: 'first'}]}]},
                    {type: 'listItem', content: [
                        {type: 'paragraph', content: [{type: 'text', text: 'second'}]}]},
                ],
            }],
        }
        expect(prose_to_text(doc)).toBe('first second')
    })

    it('is empty for a missing or wholly blank doc', () => {
        expect(prose_to_text(undefined)).toBe('')
        expect(prose_to_text(make_doc(undefined, undefined))).toBe('')
    })
})
