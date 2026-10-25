
// The arithmetic of zooming a preview (preview_zoom.ts): how far it may zoom, what one Ctrl+wheel
// step does, and the scroll that keeps the point under the pointer in place

import {describe, it, expect} from 'vitest'

import {PX_PER_PT, A4_WIDTH_IN, zoom_limits, clamp_zoom, wheel_zoom, anchored_scroll}
    from '@/services/preview_zoom'


describe('zoom_limits', () => {

    it('lets a desktop zoom from a quarter of print size to four times it', () => {
        expect(zoom_limits(true, 0.6)).toEqual({min: 0.25, max: 4})
    })

    it('always reaches the zoom that fits the pane, however far out that is', () => {
        expect(zoom_limits(true, 0.1)).toEqual({min: 0.1, max: 4})
        expect(zoom_limits(true, 5)).toEqual({min: 0.25, max: 5})
    })

    it('only lets a phone zoom in from its pages filling the width', () => {
        expect(zoom_limits(false, 1)).toEqual({min: 1, max: 4})
    })
})


describe('clamp_zoom', () => {

    it('keeps a zoom within its limits', () => {
        const limits = {min: 0.25, max: 4}
        expect(clamp_zoom(0.1, limits)).toBe(0.25)
        expect(clamp_zoom(9, limits)).toBe(4)
        expect(clamp_zoom(1.5, limits)).toBe(1.5)
    })
})


describe('wheel_zoom', () => {

    it('zooms in for a wheel turned up and out for one turned down, by the same factor', () => {
        const zoomed_in = wheel_zoom(1, {deltaY: -10, deltaMode: 0})
        const zoomed_out = wheel_zoom(1, {deltaY: 10, deltaMode: 0})
        expect(zoomed_in).toBeGreaterThan(1)
        expect(zoomed_in * zoomed_out).toBeCloseTo(1)
    })

    it('is multiplicative, so a step looks the same at any zoom', () => {
        const event = {deltaY: -10, deltaMode: 0}
        expect(wheel_zoom(2, event) / 2).toBeCloseTo(wheel_zoom(0.5, event) / 0.5)
    })

    it('keeps a mouse wheel\'s notch to a modest step, in pixels or lines', () => {
        const notch = wheel_zoom(1, {deltaY: -120, deltaMode: 0})
        expect(notch).toBeLessThan(1.3)
        expect(wheel_zoom(1, {deltaY: -3, deltaMode: 1})).toBeCloseTo(notch)
    })
})


describe('anchored_scroll', () => {

    it('keeps the point under the focus in place as the content grows', () => {
        // The content doubles in size about its top-left corner, with the focus a quarter of the
        // way across and halfway down it: that point moves 50px right and 100px down
        const before = {left: 0, top: 0, width: 200, height: 200}
        const after = {left: 0, top: 0, width: 400, height: 400}
        expect(anchored_scroll(before, after, {x: 50, y: 100})).toEqual({x: 50, y: 100})
    })

    it('needs no scroll where the point is where it was', () => {
        // Content centred in the pane grows around its centre, focused on that centre
        const before = {left: 100, top: 0, width: 200, height: 200}
        const after = {left: 0, top: -100, width: 400, height: 400}
        expect(anchored_scroll(before, after, {x: 200, y: 100})).toEqual({x: 0, y: 0})
    })
})


describe('print size', () => {

    it('shows a point at a 72nd of a CSS inch, so A4 is 794px wide at a zoom of 1', () => {
        expect(A4_WIDTH_IN * 72 * PX_PER_PT).toBeCloseTo(793.7, 1)
    })
})
