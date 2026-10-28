
import {describe, it, expect} from 'vitest'

import {resolve_trim, convert_unit, typst_unit, usable_length} from '../src/index.js'
import {resolve_binding_gutter} from '../src/trim.js'
import {make_blueprint} from './fixtures.js'

import type {Blueprint} from '../src/types.js'


// A custom-dimensions blueprint (no named size) of the given trim size
const custom_blueprint = (width:number, height:number, unit:'mm'|'inch'):Blueprint =>
    ({size_id: '', service_id: 'custom', custom_unit: unit, custom_trim_width: width,
        custom_trim_height: height} as unknown as Blueprint)


describe('typst_unit', () => {

    it('maps the blueprint spelling to the one typst understands', () => {
        expect(typst_unit('mm')).toBe('mm')
        expect(typst_unit('inch')).toBe('in')
    })

})


describe('usable_length', () => {

    it('keeps an ordinary length', () => {
        expect(usable_length(12.5)).toBe(12.5)
        expect(usable_length(0)).toBe(0)
    })

    it('treats a length stepped below zero as no space', () => {
        expect(usable_length(0.95 - 1)).toBe(0)
        expect(usable_length(-3.41)).toBe(0)
    })

    it('treats a cleared or non-numeric field as no space', () => {
        expect(usable_length('' as unknown as number)).toBe(0)
        expect(usable_length(NaN)).toBe(0)
        expect(usable_length(Infinity)).toBe(0)
    })

})


describe('convert_unit', () => {

    it('is a no-op when units match', () => {
        expect(convert_unit(5, 'inch', 'inch')).toBe(5)
        expect(convert_unit(120, 'mm', 'mm')).toBe(120)
    })

    it('converts mm <-> inches', () => {
        expect(convert_unit(25.4, 'mm', 'inch')).toBeCloseTo(1)
        expect(convert_unit(2, 'inch', 'mm')).toBeCloseTo(50.8)
    })

})


describe('resolve_trim', () => {

    it('returns the custom dimensions verbatim when no named size is set', () => {
        expect(resolve_trim(custom_blueprint(5, 8, 'inch')))
            .toEqual({width: 5, height: 8, unit: 'inch'})
        expect(resolve_trim(custom_blueprint(120, 190, 'mm')))
            .toEqual({width: 120, height: 190, unit: 'mm'})
    })

    it('resolves a named size from the common list for the service-less modes', () => {
        const blue = {size_id: 'a5', service_id: 'home'} as unknown as Blueprint
        const trim = resolve_trim(blue)
        expect(trim.width).toBeGreaterThan(0)
        expect(trim.height).toBeGreaterThan(trim.width)
    })

    it('falls back to custom dimensions for an unknown named size', () => {
        const blue = {size_id: 'not_a_real_size', service_id: 'home', custom_unit: 'inch',
            custom_trim_width: 4, custom_trim_height: 6} as unknown as Blueprint
        expect(resolve_trim(blue)).toEqual({width: 4, height: 6, unit: 'inch'})
    })

})


describe('resolve_binding_gutter', () => {

    // A Lulu US-trade paperback, in mm
    const lulu = (overrides:Partial<Blueprint> = {}):Blueprint => make_blueprint({
        service_id: 'lulu', size_id: 'us_trade', binding_type: 'paperback', booklet: false,
        margin_unit: 'mm', ...overrides} as Partial<Blueprint>)

    it('asks the printing service, and a thicker book needs a deeper gutter', () => {
        const thin = resolve_binding_gutter(lulu(), 100)
        expect(thin).toBeCloseTo(3.175)
        expect(resolve_binding_gutter(lulu(), 600)).toBeGreaterThan(thin)
    })

    it('measures a custom trim size by its dimensions', () => {
        const custom = lulu({size_id: '', custom_unit: 'mm', custom_trim_width: 152,
            custom_trim_height: 229} as Partial<Blueprint>)
        expect(resolve_binding_gutter(custom, 100)).toBeGreaterThan(0)
    })

    it('adds nothing where no service binds the book', () => {
        for (const service_id of ['home', 'custom', '']){
            expect(resolve_binding_gutter(lulu({service_id} as Partial<Blueprint>), 100)).toBe(0)
        }
        expect(resolve_binding_gutter(lulu({booklet: true}), 100)).toBe(0)
    })

    // Neither an unknown service nor a binding it doesn't offer may break the compile
    it('adds nothing for a service or binding printing-services does not know', () => {
        expect(resolve_binding_gutter(lulu({service_id: 'no_such_service'} as Partial<Blueprint>),
            100)).toBe(0)
        expect(resolve_binding_gutter(lulu({binding_type: 'no_such_binding'} as Partial<Blueprint>),
            100)).toBe(0)
    })
})
