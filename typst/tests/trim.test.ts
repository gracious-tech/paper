
import {describe, it, expect} from 'vitest'

import {resolve_trim, convert_unit} from '../src/index.js'

import type {Blueprint} from '../src/types.js'


// A custom-dimensions blueprint (no named size) of the given trim size
const custom_blueprint = (width:number, height:number, unit:'mm'|'inch'):Blueprint =>
    ({size_id: '', service_id: 'custom', custom_unit: unit, custom_trim_width: width,
        custom_trim_height: height} as unknown as Blueprint)


describe('convert_unit', () => {

    it('is a no-op when units match', () => {
        expect(convert_unit(5, 'in', 'in')).toBe(5)
        expect(convert_unit(120, 'mm', 'mm')).toBe(120)
    })

    it('converts mm <-> in', () => {
        expect(convert_unit(25.4, 'mm', 'in')).toBeCloseTo(1)
        expect(convert_unit(2, 'in', 'mm')).toBeCloseTo(50.8)
    })

})


describe('resolve_trim', () => {

    it('returns the custom dimensions verbatim when no named size is set', () => {
        expect(resolve_trim(custom_blueprint(5, 8, 'inch'))).toEqual({width: 5, height: 8, unit: 'in'})
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
        expect(resolve_trim(blue)).toEqual({width: 4, height: 6, unit: 'in'})
    })

})
