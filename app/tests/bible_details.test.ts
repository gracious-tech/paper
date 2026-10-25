
// The facts and description shown under a translation in the Bible picker, from fetch.bible's
// manifest tags and descriptions — every part optional, and missing parts simply left out

import {describe, it, expect} from 'vitest'

import {bible_details} from '@/services/bible_details'

import {echo_t as t} from './helpers/i18n'

import type {GetResourcesItem} from '@gracious.tech/fetch-client'


// A translation as bible_details() reads it
function trans(year:number, tags:string[]){
    return {year, tags: tags as GetResourcesItem['tags']}
}


describe('bible_details', () => {

    it('orders year, literalness, provenance and NT text', () => {
        const details = bible_details(trans(2020, ['byz', 'literal1', 'recommended']),
            {english: "A literal one", provenance: 'YLT'}, t)
        expect(details.facts).toEqual(['2020', 'svc.bible_details.literal1',
            'svc.bible_details.derived_from(source=YLT)', 'svc.bible_details.byz'])
        expect(details.description).toBe("A literal one")
    })

    it('calls a described translation without provenance original', () => {
        const details = bible_details(trans(2024, ['alex', 'literal3']), {english: "Modern"}, t)
        expect(details.facts).toEqual(['2024', 'svc.bible_details.literal3',
            'svc.bible_details.original', 'svc.bible_details.alex'])
    })

    it('claims no provenance for a translation fetch.bible did not describe', () => {
        const details = bible_details(trans(1901, ['literal2']), undefined, t)
        expect(details).toEqual({facts: ['1901', 'svc.bible_details.literal2'], description: ''})
    })

    it('leaves out tags that are absent', () => {
        expect(bible_details(trans(2016, []), undefined, t).facts).toEqual(['2016'])
        expect(bible_details(trans(0, []), undefined, t).facts).toEqual([])
    })

    it('prefers the description in the translation\'s own language', () => {
        const description = {english: "In English", local: "Local"}
        expect(bible_details(trans(2020, []), description, t).description).toBe("Local")
    })

})

