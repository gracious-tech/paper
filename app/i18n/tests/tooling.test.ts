
// The translation tooling's own rules: what the apply step refuses, what it only warns about,
// and what the lint counts as untranslated text. These are the guard rails that let a model do
// the translating unsupervised, so each refusal here is one kind of broken UI kept out.

import {describe, it, expect} from 'vitest'

import {translation_errors, translation_warnings, context_for, arg_names, style_key}
    from '../lib.ts'
import {lint_source} from '../lint.ts'

import type {GlossaryTerm, Site} from '../lib.ts'


const glossary:Record<string, GlossaryTerm> = {
    'Paper Bible': {note: 'Product name', keep: true},
    'design': {note: 'A saved document'},
}


describe('translation_errors', () => {

    it('accepts a faithful translation', () => {
        expect(translation_errors('{n} pages', '{n} trang', glossary)).toEqual([])
    })

    it('refuses a dropped placeholder', () => {
        expect(translation_errors('{n} pages', 'trang', glossary))
            .toEqual(['missing placeholder {n}'])
    })

    it('refuses a translated placeholder name', () => {
        // The commonest model mistake: translating the word inside the braces
        expect(translation_errors('{pages} left', '{trang} còn lại', glossary)).toEqual([
            'missing placeholder {pages}',
            'unexpected placeholder {trang} (placeholder names are never translated)',
        ])
    })

    it('accepts a placeholder moved elsewhere in the sentence', () => {
        expect(translation_errors('Made by {org}.', '{org} đã làm.', glossary)).toEqual([])
    })

    it('refuses an empty translation', () => {
        expect(translation_errors('Save', '  ', glossary)).toEqual(['empty'])
    })

    it('refuses a value that is not a string', () => {
        expect(translation_errors('Save', 3, glossary)).toEqual(['not a string'])
    })

    it('refuses changed HTML tags', () => {
        expect(translation_errors('<b>Bold</b> text', 'Chữ đậm', glossary))
            .toEqual(['HTML tags differ from the English'])
    })

    it('refuses a changed number of lines', () => {
        expect(translation_errors('One\nTwo', 'Một Hai', glossary))
            .toEqual(['line count differs from the English'])
    })

    it('refuses a keep-term that was translated', () => {
        expect(translation_errors('About Paper Bible', 'Về Kinh Thánh Giấy', glossary))
            .toEqual(['must keep "Paper Bible" verbatim'])
    })

    it('accepts positional placeholders', () => {
        expect(translation_errors('Clear {0}', 'Xóa {0}', glossary)).toEqual([])
    })
})


describe('translation_warnings', () => {

    it('flags a long string left in English', () => {
        expect(translation_warnings('Download the PDF', 'Download the PDF', {}))
            .toEqual(['identical to the English'])
    })

    it('lets a short string match the English', () => {
        // "OK", "PDF" and the like are often right as they are
        expect(translation_warnings('OK', 'OK', {})).toEqual([])
    })

    it('flags a glossary term rendered other than the locale chose', () => {
        const terms = {terms: {design: 'thiết kế'}}
        expect(translation_warnings('Delete design', 'Xóa bản vẽ', terms))
            .toEqual(['glossary term "design" not rendered as "thiết kế"'])
    })

    it('ignores a glossary term that is only a placeholder name', () => {
        expect(translation_warnings('{binding}, standard ink', '{binding}, mực tiêu chuẩn',
            {terms: {binding: 'đóng sách'}})).toEqual([])
    })

    it('ignores a glossary term inside a keep-term', () => {
        expect(translation_warnings('About Paper Bible', 'Về Paper Bible',
            {terms: {Bible: 'Kinh Thánh'}}, glossary)).toEqual([])
    })

    it('accepts the chosen rendering of a glossary term', () => {
        const terms = {terms: {design: 'thiết kế'}}
        expect(translation_warnings('Delete design', 'Xóa thiết kế', terms))
            .toEqual([])
    })
})


describe('context_for', () => {

    it('shows where a key is used and its note', () => {
        const usage = new Map<string, Site[]>([['a.b', [
            {file: 'app/src/comp/X.vue', line: 4, code: 'v-btn {{ $t("a.b") }}'},
        ]]])
        expect(context_for('a.b', usage, {'a.b': 'A button'})).toEqual({
            where: ['comp/X.vue:4  v-btn {{ $t("a.b") }}'],
            note: 'A button',
        })
    })

    it('has no sites for a key only built at runtime', () => {
        expect(context_for('x.one', new Map(), {})).toEqual({where: []})
    })
})


describe('arg_names', () => {

    it('collects each placeholder once', () => {
        expect([...arg_names('{a} {b} {a}')]).toEqual(['a', 'b'])
    })
})


describe('style_key', () => {

    it('files a UI tag and a document code for one written language together', () => {
        // The UI is keyed by browser tags, document strings by fetch.bible codes
        expect(style_key('de')).toBe(style_key('deu'))
        expect(style_key('pt-BR')).toBe(style_key('por'))
        expect(style_key('ar')).toBe(style_key('arb'))
        expect(style_key('fa')).toBe(style_key('pes'))
        expect(style_key('zh-Hans')).toBe(style_key('cmn-Hans'))
    })

    it('keeps a language\'s other scripts apart', () => {
        expect(style_key('cmn-Hant')).toBe('zh-Hant')
        expect(style_key('zh-Hant')).not.toBe(style_key('zh-Hans'))
        expect(style_key('sr-Latn')).not.toBe(style_key('srp'))
    })

    it('is the bare language for its usual script', () => {
        expect(style_key('de')).toBe('de')
        expect(style_key('zh-Hans')).toBe('zh')
    })
})


describe('lint_source', () => {

    // Just the text of each finding, for brevity
    const lint = (file:string, source:string) => lint_source(file, source).map(f => f.text)

    it('flags a double-quoted literal in TypeScript', () => {
        expect(lint('x.ts', 'show_toast("Saved")\n')).toEqual(['Saved'])
    })

    it('ignores single-quoted literals, which are code', () => {
        expect(lint('x.ts', "const mode = 'passage'\n")).toEqual([])
    })

    it('ignores the key passed to a translation call', () => {
        expect(lint('x.ts', 'translate("a.b")\nt("c.d")\n')).toEqual([])
    })

    it('honours i18n-ignore on the line or the line above', () => {
        expect(lint('x.ts', 'a("Kept")  // i18n-ignore\n// i18n-ignore\nb("Also")\n')).toEqual([])
    })

    it('honours i18n-ignore-file', () => {
        expect(lint('x.ts', '// i18n-ignore-file\na("Kept")\n')).toEqual([])
    })

    it('flags plain text and static UI attributes in a Pug template', () => {
        const vue = "<template lang='pug'>\nv-btn(label='Go away') Save now\n</template>\n"
        expect(lint('X.vue', vue)).toEqual(['Go away', 'Save now'])
    })

    it('leaves interpolated translations and entities alone', () => {
        const vue = "<template lang='pug'>\nspan &nbsp;— {{ $t(\"a.b\") }}\n</template>\n"
        expect(lint('X.vue', vue)).toEqual([])
    })

    it('flags only phrase-like literals inside template expressions', () => {
        // Inside a template the attribute's own quotes force double ones, so identifiers like
        // a color name can't be told apart by quoting — only by looking like words
        const vue = "<template lang='pug'>\n"
            + "v-btn(:color='on ? \"success-light\" : \"\"' :title='on ? \"Turn it off\" : \"\"')\n"
            + '</template>\n'
        expect(lint('X.vue', vue)).toEqual(['Turn it off'])
    })

    it('reports the line in the file, not in the block', () => {
        const vue = "\n<template lang='pug'>\ndiv\n    p Hello there\n</template>\n"
        expect(lint_source('X.vue', vue)[0]?.line).toBe(4)
    })
})
