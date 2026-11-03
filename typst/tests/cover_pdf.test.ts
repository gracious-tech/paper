
import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'

import {cover_form_for_render, cover_prints_split, split_cover_pdf} from '../src/index.js'
import {make_blueprint} from './fixtures.js'

import type {CoverConfig} from '../src/types.js'


const mm_to_pt = (mm:number) => mm / 25.4 * 72

const blank_cover:CoverConfig = {form: {}, bg_image: null, font_families: [], title_custom: false}


describe('cover_prints_split', () => {

    it('splits only a home-printed cover that is not a booklet', () => {
        expect(cover_prints_split(make_blueprint({service_id: 'home', booklet: false}))).toBe(true)
        expect(cover_prints_split(make_blueprint({service_id: 'home', booklet: true}))).toBe(false)
        expect(cover_prints_split(make_blueprint({service_id: 'lulu', booklet: false})))
            .toBe(false)
        expect(cover_prints_split(make_blueprint({service_id: 'custom', booklet: false})))
            .toBe(false)
    })

    it('splits a custom-service cover only when asked', () => {
        const custom = make_blueprint({service_id: 'custom', cover_split: true, custom_spine: 5})
        expect(cover_prints_split(custom)).toBe(true)
        expect(cover_prints_split({...custom, cover_split: false})).toBe(false)
        // The choice belongs to the custom service alone
        expect(cover_prints_split({...custom, service_id: 'lulu'})).toBe(false)
    })

    // The faces are printed apart, so a spine the user set is dropped while they are, and comes
    // back when they aren't
    it('renders a split custom cover without its spine', () => {
        const custom = make_blueprint({service_id: 'custom', cover_split: true, custom_spine: 5})
        expect(cover_form_for_render(blank_cover, custom, 100)['custom_spine']).toBe(0)
        expect(cover_form_for_render(blank_cover, {...custom, cover_split: false}, 100)
            ['custom_spine']).toBe(5)
    })

})


describe('split_cover_pdf', () => {

    // A home A5 cover's wraparound is two A5 faces side by side (no bleed, no spine), back on
    // the left and front on the right
    it('puts the front face on page one and the back face on page two', async () => {
        const blueprint = make_blueprint({service_id: 'home', booklet: false, size_id: 'a5'})
        const form = cover_form_for_render(blank_cover, blueprint, 100)
        const wraparound = await PDFDocument.create()
        wraparound.addPage([mm_to_pt(148 * 2), mm_to_pt(210)])

        const split = await PDFDocument.load(await split_cover_pdf(await wraparound.save(), form))
        expect(split.getPageCount()).toBe(2)
        const [front, back] = split.getPages().map(page => page.getMediaBox())
        expect(front?.x).toBeCloseTo(mm_to_pt(148), 1)
        expect(back?.x).toBeCloseTo(0, 1)
        for (const box of [front, back]){
            expect(box?.y).toBeCloseTo(0, 1)
            expect(box?.width).toBeCloseTo(mm_to_pt(148), 1)
            expect(box?.height).toBeCloseTo(mm_to_pt(210), 1)
        }
        // The crop box matches, so viewers and printers agree on the page
        expect(split.getPage(0).getCropBox()).toEqual(split.getPage(0).getMediaBox())
    })

    // A custom service's 3mm bleed surrounds the whole wraparound, and each face keeps it on
    // every side, its fold side included
    it('keeps the bleed around each face', async () => {
        const blueprint = make_blueprint({service_id: 'custom', booklet: false, size_id: 'a5',
            custom_bleed: 3, custom_spine: 10, cover_split: true})
        const form = cover_form_for_render(blank_cover, blueprint, 100)
        const wraparound = await PDFDocument.create()
        wraparound.addPage([mm_to_pt(148 * 2 + 6), mm_to_pt(210 + 6)])

        const split = await PDFDocument.load(await split_cover_pdf(await wraparound.save(), form))
        const [front, back] = split.getPages().map(page => page.getMediaBox())
        expect(front?.x).toBeCloseTo(mm_to_pt(148), 1)
        expect(back?.x).toBeCloseTo(0, 1)
        for (const box of [front, back]){
            expect(box?.y).toBeCloseTo(0, 1)
            expect(box?.width).toBeCloseTo(mm_to_pt(148 + 6), 1)
            expect(box?.height).toBeCloseTo(mm_to_pt(210 + 6), 1)
        }
    })

})
