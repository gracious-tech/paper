
import {describe, it, expect} from 'vitest'

import {gen_qr_typst} from '../src/qr.js'


describe('gen_qr_typst', () => {

    it('wraps the code in a square box at the requested width', () => {
        const out = gen_qr_typst('https://paper.bible', {width: '3cm'})
        expect(out).toContain('box(width: 3cm, height: 3cm,')
    })

    it('defaults to a 2.6cm code', () => {
        expect(gen_qr_typst('x')).toContain('box(width: 2.6cm, height: 2.6cm,')
    })

    it('draws one closed square per dark module', () => {
        const out = gen_qr_typst('https://paper.bible')
        const moves = out.match(/curve\.move\(/g)?.length ?? 0
        const closes = out.match(/curve\.close\(\)/g)?.length ?? 0
        expect(moves).toBeGreaterThan(0)
        expect(moves).toBe(closes)
    })

    it('sizes modules as a fraction of the total width, so the quiet zone is included', () => {
        // `border` bakes the quiet zone into the matrix, so the unit must divide the full width
        expect(gen_qr_typst('x', {width: '4cm'})).toContain('(4cm / ')
    })

    it('inherits the surrounding text colour when no colour is given', () => {
        const out = gen_qr_typst('x')
        expect(out).toContain('fill: text.fill')
        // text.fill is only readable inside a context block
        expect(out.startsWith('context ')).toBe(true)
    })

    it('uses an explicit colour without needing a context block', () => {
        const out = gen_qr_typst('x', {color: '#112233'})
        expect(out).toContain('fill: rgb("#112233")')
        expect(out).not.toContain('text.fill')
        expect(out.startsWith('context ')).toBe(false)
    })

    it('never strokes the modules (a stroke would blur a small printed code)', () => {
        expect(gen_qr_typst('x')).toContain('stroke: none')
    })

    it('returns a bare code-mode expression, not markup', () => {
        expect(gen_qr_typst('x').startsWith('#')).toBe(false)
        expect(gen_qr_typst('x', {color: '#000000'}).startsWith('#')).toBe(false)
    })

    it('encodes different data into different markup', () => {
        expect(gen_qr_typst('https://paper.bible/a'))
            .not.toBe(gen_qr_typst('https://paper.bible/b'))
    })

    it('is deterministic for the same input', () => {
        expect(gen_qr_typst('https://paper.bible')).toBe(gen_qr_typst('https://paper.bible'))
    })

    it('grows the matrix for longer data', () => {
        const short_modules = gen_qr_typst('a').match(/curve\.move\(/g)!.length
        const long = gen_qr_typst('a'.repeat(200)).match(/curve\.move\(/g)!.length
        expect(long).toBeGreaterThan(short_modules)
    })

    it('handles a URL with query and fragment', () => {
        const out = gen_qr_typst('https://paper.bible/designs/a-b_c~d/v1?x=1#frag')
        expect(out).toContain('curve.move(')
    })
})
