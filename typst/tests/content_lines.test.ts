
import {describe, it, expect} from 'vitest'

import {gen_lines} from '../src/content_lines.js'
import {TEST_PAGE, make_lines} from './fixtures.js'


describe('gen_lines', () => {

    it('generates a grid of dotted lines', () => {
        const result = gen_lines(make_lines(), TEST_PAGE)
        expect(result).toContain('#grid(')
        expect(result).toContain('dash: "dotted"')
        expect(result).toContain('thickness: 0.5pt')
    })

    it('uses the specified spacing', () => {
        const result = gen_lines(make_lines({spacing: '8mm'}), TEST_PAGE)
        expect(result).toContain('(8mm,)')
    })

    it('calculates enough rows for a full page', () => {
        const result = gen_lines(make_lines({spacing: '10mm'}), TEST_PAGE)
        // 420mm / 10mm = 42 rows
        expect(result).toContain('* 42')
        expect(result).toContain('range(42)')
    })

    it('uses full-width lines', () => {
        const result = gen_lines(make_lines(), TEST_PAGE)
        expect(result).toContain('length: 100%')
    })

    it('adjusts row count for different spacings', () => {
        // 420mm / 5mm = 84 rows
        const result = gen_lines(make_lines({spacing: '5mm'}), TEST_PAGE)
        expect(result).toContain('* 84')
    })

    it('handles inch spacing', () => {
        // 420mm / 25.4mm = 17 rows (ceil)
        const result = gen_lines(make_lines({spacing: '1in'}), TEST_PAGE)
        expect(result).toContain('* 17')
    })
})
