
import {describe, it, expect} from 'vitest'

import {doc_translator, doc_language} from '../src/doc_strings.js'
import {DOC_SOURCE, DOC_TRANSLATIONS} from '../src/generated/doc_strings.js'

import type {GetResourcesItem} from '@gracious.tech/fetch-client'


describe('doc_translator', () => {

    it('uses the language\'s own catalog', () => {
        expect(doc_translator('vie')('doc.chapter', {n: 3})).toBe('Chương 3')
    })

    it('uses a script\'s own catalog, so Chinese Bibles print in their own script', () => {
        expect(doc_translator('cmn-Hans')('doc.copyright.resources')).not.toBe(
            doc_translator('cmn-Hant')('doc.copyright.resources'))
    })

    it('falls back to the bare language for a script with no catalog of its own', () => {
        expect(doc_translator('vie-Latn')('doc.chapter', {n: 3})).toBe('Chương 3')
    })

    it('falls back to English for a language with no catalog', () => {
        expect(doc_translator('xyz')('doc.chapter', {n: 3})).toBe('Chapter 3')
        expect(doc_translator(undefined)('doc.copyright.resources')).toBe('Resources used:')
    })

    it('leaves a placeholder it wasn\'t given a value for', () => {
        expect(doc_translator('eng')('doc.chapter')).toBe('Chapter {n}')
    })
})


describe('doc_language', () => {

    const resources = {
        vie_x: {language: 'vie', script: undefined},
        eng_y: {language: 'eng', script: undefined},
        cmn_t: {language: 'cmn', script: 'Hant'},
    } as unknown as Record<string, GetResourcesItem>

    it('is the primary translation\'s language', () => {
        expect(doc_language({bibles: ['vie_x', 'eng_y']}, resources)).toBe('vie')
    })

    it('includes the script when the translation declares one', () => {
        expect(doc_language({bibles: ['cmn_t', 'eng_y']}, resources)).toBe('cmn-Hant')
    })

    it('is unknown for an unlisted translation', () => {
        expect(doc_language({bibles: ['gone_z']}, resources)).toBeUndefined()
    })
})


describe('the compiled catalogs', () => {

    // Written by app/i18n/gen_doc.ts, whose check (.bin/i18n_check) keeps it in step with
    // typst/locales/ — these only guard the shape this package relies on

    it('has no key the source lacks', () => {
        for (const catalog of Object.values(DOC_TRANSLATIONS)){
            expect(Object.keys(catalog).filter(key => !(key in DOC_SOURCE))).toEqual([])
        }
    })

    it('keeps {n} in every chapter label', () => {
        for (const label of [DOC_SOURCE['doc.chapter'],
                ...Object.values(DOC_TRANSLATIONS).map(c => c['doc.chapter'])]){
            if (label !== undefined){
                expect(label).toContain('{n}')
            }
        }
    })
})
