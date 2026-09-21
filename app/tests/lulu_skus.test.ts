
// Lulu's product vocabulary. This module is the single definition shared by the app (which
// builds ids to quote a design) and app/tools/gen_lulu_prices.ts (which enumerates it to decide
// which prices to pull), so the generated price table can never cover a different set of
// products than the app can actually produce — the last describe below is what keeps that true.

import {describe, it, expect} from 'vitest'

import {build_pod_package_id, parse_pod_package_id, list_app_pod_package_ids, TRIM_SKU, INK_SKU,
    BINDING_SKU, PAPER_SKU} from '@/services/lulu_skus'
import {lulu_book_price, lulu_page_limits} from '@/services/lulu_prices'


describe('build_pod_package_id', () => {

    it('assembles the six SKU components in order', () => {
        expect(build_pod_package_id('a5', 'bw', 'paperback', 'white'))
            .toBe('0583X0827.BW.STD.PB.060UW444.MXX')
    })

    it('maps one ink choice onto both ink and quality components', () => {
        expect(build_pod_package_id('a5', 'color_premium', 'paperback', 'white'))
            .toContain('.FC.PRE.')
        expect(build_pod_package_id('a5', 'bw_premium', 'paperback', 'white'))
            .toContain('.BW.PRE.')
    })

    it('uses the linen finish a jacketed hardcover cannot go without', () => {
        expect(build_pod_package_id('a5', 'bw', 'hardcover_jacket', 'white')?.endsWith('.MBB'))
            .toBe(true)
        expect(build_pod_package_id('a5', 'bw', 'hardcover', 'white')?.endsWith('.MXX'))
            .toBe(true)
    })

    // A design Lulu has no product for simply can't be quoted — better than quoting a SKU that
    // doesn't exist
    it('returns null for a custom trim size', () => {
        expect(build_pod_package_id('', 'bw', 'paperback', 'white')).toBe(null)
    })

    it('returns null for an unknown component', () => {
        expect(build_pod_package_id('a5', 'neon', 'paperback', 'white')).toBe(null)
        expect(build_pod_package_id('a5', 'bw', 'ring_bound', 'white')).toBe(null)
        expect(build_pod_package_id('a5', 'bw', 'paperback', 'papyrus')).toBe(null)
        expect(build_pod_package_id('not_a_size', 'bw', 'paperback', 'white')).toBe(null)
    })
})


describe('parse_pod_package_id', () => {

    it('splits an id into its trim, band and price key', () => {
        const parts = parse_pod_package_id('0583X0827.BW.STD.PB.060UW444.MXX')
        expect(parts).toEqual({trim: '0583X0827', band: 'S',
            price_key: 'S.BW.STD.PB.060UW444'})
    })

    it('bands anything above 6x9in as medium', () => {
        // Lulu charges one price up to 6x9 and another above it, with nothing in between
        expect(parse_pod_package_id('0600X0900.BW.STD.PB.060UW444.MXX')!.band).toBe('S')
        expect(parse_pod_package_id('0827X1169.BW.STD.PB.060UW444.MXX')!.band).toBe('M')
    })

    it('leaves the cover finish out of the price key — it does not affect price', () => {
        const matte = parse_pod_package_id('0583X0827.BW.STD.CW.060UW444.MXX')!
        const linen = parse_pod_package_id('0583X0827.BW.STD.CW.060UW444.MBB')!
        expect(matte.price_key).toBe(linen.price_key)
    })

    it('returns null for a malformed id', () => {
        expect(parse_pod_package_id('')).toBe(null)
        expect(parse_pod_package_id('0583X0827')).toBe(null)
        expect(parse_pod_package_id('0583X0827.BW.STD')).toBe(null)
    })

    it('round-trips every id the app can build', () => {
        for (const id of list_app_pod_package_ids()){
            expect(parse_pod_package_id(id)).not.toBe(null)
        }
    })
})


describe('list_app_pod_package_ids', () => {

    it('returns products', () => {
        expect(list_app_pod_package_ids().length).toBeGreaterThan(0)
    })

    it('has no duplicates', () => {
        const ids = list_app_pod_package_ids()
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('only names components the SKU tables define', () => {
        const trims = new Set(Object.values(TRIM_SKU))
        const inks = new Set(Object.values(INK_SKU).map(pair => pair[0]))
        const qualities = new Set(Object.values(INK_SKU).map(pair => pair[1]))
        const bindings = new Set(Object.values(BINDING_SKU))
        const papers = new Set(Object.values(PAPER_SKU))
        for (const id of list_app_pod_package_ids()){
            const [trim, ink, quality, binding, paper] = id.split('.')
            expect(trims.has(trim!)).toBe(true)
            expect(inks.has(ink!)).toBe(true)
            expect(qualities.has(quality!)).toBe(true)
            expect(bindings.has(binding!)).toBe(true)
            expect(papers.has(paper!)).toBe(true)
        }
    })

    it('excludes combinations Lulu does not sell', () => {
        // A linen-wrapped pocketbook is a combination the option lists rule out
        const ids = list_app_pod_package_ids()
        expect(ids).not.toContain('0425X0687.BW.STD.LW.060UW444.MBB')
    })
})


describe('agreement with the generated price table', () => {

    // The reason both halves live in one module. A product the app can offer but the table has
    // no row for quotes as "not printable" to a user who can see the option right there

    const ids = list_app_pod_package_ids()

    it('prices every product the app can produce', () => {
        const unpriced = ids.filter(id => lulu_book_price(id, 100, 'USD') === null)
        expect(unpriced).toEqual([])
    })

    it('has page limits for every product the app can produce', () => {
        const unlimited = ids.filter(id => lulu_page_limits(id) === null)
        expect(unlimited).toEqual([])
    })

    it('prices every product in every currency it quotes', () => {
        for (const currency of ['USD', 'GBP', 'EUR', 'AUD', 'CAD'] as const){
            const missing = ids.filter(id => lulu_book_price(id, 100, currency) === null)
            expect(missing).toEqual([])
        }
    })
})
