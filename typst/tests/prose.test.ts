
import {describe, it, expect} from 'vitest'

import {prose_to_typst, prose_to_text, resolve_prose_dir, doc_has_copyright, COPYRIGHT_MARKER}
    from '../src/prose.js'

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
        expect(result).toBe('one\n\n#box();\n\ntwo')
    })

    it('keeps each of several consecutive blank lines', () => {
        const result = prose_to_typst(make_doc('one', undefined, undefined, 'two'), true)
        expect(result).toBe('one\n\n#box();\n\n#box();\n\ntwo')
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
        expect(prose_to_typst(doc, true)).toBe('#align(center)[*centred*];')
    })

    it('returns empty markup for a missing doc', () => {
        expect(prose_to_typst(undefined, true)).toBe('')
    })

    it('leaves text running the document\'s way unscoped', () => {
        expect(prose_to_typst(make_doc('English'), false, 'ltr')).toBe('English')
        expect(prose_to_typst(make_doc('עברית'), false, 'rtl')).toBe('עברית')
    })

    it('gives a page in the other direction its own scope', () => {
        // The digits-only paragraph has no letter to go by, so it follows the page
        const result = prose_to_typst(make_doc('Introduction', '2026'), false, 'rtl')
        expect(result).toBe('#[#set text(dir: ltr)\nIntroduction\n\n2026\n];')
    })

    it('scopes a single paragraph running against the page', () => {
        const result = prose_to_typst(make_doc('Dedication', 'مقدمة', 'More'), false, 'ltr')
        expect(result).toBe('Dedication\n\n#[#set text(dir: rtl)\nمقدمة\n];\n\nMore')
    })

    it('keeps a heading\'s marker at the start of its line', () => {
        const doc:PmDoc = {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: 'Text'}]},
            {type: 'heading', attrs: {level: 1}, content: [{type: 'text', text: 'כותרת'}]},
        ]}
        expect(prose_to_typst(doc, false, 'ltr')).toContain('#set text(dir: rtl)\n= כותרת\n];')
    })

    it('spells out a left alignment the user chose for RTL text', () => {
        // pm-to-typst drops 'left' as the default, which only holds in LTR text
        const doc = (text:string):PmDoc => ({type: 'doc', content: [{type: 'paragraph',
            attrs: {textAlign: 'left'}, content: [{type: 'text', text}]}]})
        expect(prose_to_typst(doc('עברית'), false, 'rtl')).toBe('#align(left)[עברית];')
        expect(prose_to_typst(doc('English'), false, 'ltr')).toBe('English')
    })
})


describe('resolve_prose_dir', () => {

    it('takes the first letter\'s direction, else the inherited one', () => {
        expect(resolve_prose_dir(make_doc('English'), 'rtl')).toBe('ltr')
        expect(resolve_prose_dir(make_doc('1.', 'עברית'), 'ltr')).toBe('rtl')
        expect(resolve_prose_dir(make_doc('123'), 'rtl')).toBe('rtl')
        expect(resolve_prose_dir(undefined, 'ltr')).toBe('ltr')
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


describe('doc_has_copyright', () => {

    it('finds the marker in any paragraph, however deep', () => {
        expect(doc_has_copyright(make_doc('Intro', `Before ${COPYRIGHT_MARKER} after`))).toBe(true)
        expect(doc_has_copyright({type: 'doc', content: [{type: 'blockquote', content: [
            {type: 'paragraph', content: [{type: 'text', text: COPYRIGHT_MARKER}]}]}]}))
            .toBe(true)
    })

    it('is false without the marker, or without a document at all', () => {
        expect(doc_has_copyright(make_doc('Intro', undefined, 'Outro'))).toBe(false)
        expect(doc_has_copyright(undefined)).toBe(false)
    })
})
