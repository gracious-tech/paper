
// Lulu cost estimates — the parts that need no network.
//
// A quote is Lulu's published print price plus a live delivery quote from their unauthenticated
// shipping endpoint. Only the second half is a request, and it's deliberately not stubbed and
// called here: what's worth pinning down is everything around it — which currency a destination
// is quoted in, where the app guesses the user lives, and the refusals that stop a quote being
// offered for a book Lulu can't print.

import {describe, it, expect, afterEach, beforeEach, vi} from 'vitest'

import {lulu_pod_package_id, lulu_print_spec, currency_for_country, country_items,
    guess_country, remember_country, estimate_print_cost, NotPrintable} from '@/services/print_cost'
import {LULU_CURRENCIES} from '@/services/lulu_prices'
import {LULU_COUNTRIES} from '@/services/lulu_countries'

import {make_blueprint} from './helpers/blueprint'


// A minimal localStorage, since these tests run in node
function stub_storage(initial:Record<string, string> = {}):void{
    const store = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
        getItem: (key:string) => store.get(key) ?? null,
        setItem: (key:string, value:string) => void store.set(key, value),
        removeItem: (key:string) => void store.delete(key),
    })
}


// Pretend the browser prefers these languages, in order
function stub_languages(languages:string[]):void{
    vi.stubGlobal('navigator', {languages, language: languages[0] ?? 'en'})
}


beforeEach(() => {
    stub_storage()
    stub_languages(['en-US'])
})

afterEach(() => {
    vi.unstubAllGlobals()
})


// A blueprint Lulu has a product for
const printable = make_blueprint({service_id: 'lulu', size_id: 'a5', ink_type: 'bw',
    binding_type: 'paperback', paper_type: 'white'})


describe('lulu_pod_package_id', () => {

    it('builds an id for a Lulu design', () => {
        expect(lulu_pod_package_id(printable)).toBe('0583X0827.BW.STD.PB.060UW444.MXX')
    })

    it('is null for a design set up for another service', () => {
        expect(lulu_pod_package_id({...printable, service_id: 'home'})).toBe(null)
        expect(lulu_pod_package_id({...printable, service_id: 'custom'})).toBe(null)
    })

    it('is null for a custom trim size Lulu has no SKU for', () => {
        expect(lulu_pod_package_id({...printable, size_id: ''})).toBe(null)
    })
})


describe('lulu_print_spec', () => {

    it('spells out the binding, ink and paper in Lulu\'s own words', () => {
        const spec = lulu_print_spec(printable, 200)!
        expect(spec.binding).toBeTruthy()
        expect(spec.ink).toBeTruthy()
        expect(spec.paper).toBeTruthy()
    })

    it('is null for a design set up for another service', () => {
        expect(lulu_print_spec({...printable, service_id: 'home'}, 200)).toBe(null)
    })

    it('is null when an option is not one Lulu offers', () => {
        // These ids come off a client-written doc, and printing-services throws on one it
        // doesn't know rather than returning an empty list — so they can't be passed through
        // as filters unchecked (this used to take the dialog's computed down with it)
        expect(lulu_print_spec({...printable, binding_type: 'ring_bound'}, 200)).toBe(null)
        expect(lulu_print_spec({...printable, ink_type: 'neon'}, 200)).toBe(null)
        expect(lulu_print_spec({...printable, paper_type: 'papyrus'}, 200)).toBe(null)
    })

    it('still describes the book when only the size is unrecognised', () => {
        // The size scopes which bindings are offered; it isn't part of what the spec reports,
        // so a custom or unknown trim just widens that list rather than failing the whole spec
        for (const size_id of ['', 'billboard']){
            expect(lulu_print_spec({...printable, size_id}, 200)).not.toBe(null)
        }
    })

    it('suggests a cheaper binding only when one is actually valid for this book', () => {
        const dear = lulu_print_spec({...printable, binding_type: 'hardcover'}, 200)!
        expect(dear.cheaper_binding).toBeTruthy()
        // Perfect binding is already the cheapest of the ones a 200-page book can use
        expect(lulu_print_spec(printable, 200)!.cheaper_binding).toBe(null)
    })

    it('works before a page count is known', () => {
        expect(lulu_print_spec(printable, null)).not.toBe(null)
    })
})


describe('currency_for_country', () => {

    it('quotes a country Lulu prices in its own currency', () => {
        expect(currency_for_country('AU')).toBe('AUD')
        expect(currency_for_country('GB')).toBe('GBP')
        expect(currency_for_country('US')).toBe('USD')
    })

    it('falls back to USD for a destination with no currency of Lulu\'s own', () => {
        expect(currency_for_country('ZZ')).toBe('USD')
    })

    it('only ever returns a currency the price table has a column for', () => {
        for (const country of LULU_COUNTRIES){
            expect(LULU_CURRENCIES).toContain(currency_for_country(country.code))
        }
    })
})


describe('guess_country', () => {

    it('prefers the country last estimated for', () => {
        stub_storage({print_cost_country: 'KE'})
        stub_languages(['en-US'])
        expect(guess_country()).toBe('KE')
    })

    it('ignores a remembered country Lulu no longer delivers to', () => {
        stub_storage({print_cost_country: 'ZZ'})
        stub_languages(['en-AU'])
        expect(guess_country()).toBe('AU')
    })

    it('reads the region subtag of the browser\'s language', () => {
        // A region says far more about where someone is than the language does
        stub_languages(['en-KE'])
        expect(guess_country()).toBe('KE')
    })

    it('takes the first language with a deliverable region', () => {
        stub_languages(['en-ZZ', 'fr-CA'])
        expect(guess_country()).toBe('CA')
    })

    it('falls back to the language\'s main country for a bare tag', () => {
        stub_languages(['vi'])
        expect(guess_country()).toBe('VN')
        stub_languages(['pt'])
        expect(guess_country()).toBe('BR')
    })

    it('falls back to the US when nothing else says anything', () => {
        stub_languages(['xx'])
        expect(guess_country()).toBe('US')
    })

    it('always names a country Lulu delivers to', () => {
        for (const tag of ['en', 'zh', 'sw', 'ur', 'uk', 'xx', 'en-ZZ']){
            stub_languages([tag])
            const guessed = guess_country()
            expect(LULU_COUNTRIES.map(item => item.code)).toContain(guessed)
        }
    })

    it('remembers a country for next time', () => {
        stub_languages(['xx'])
        remember_country('NZ')
        expect(guess_country()).toBe('NZ')
    })
})


describe('country_items', () => {

    it('lists every destination Lulu delivers to', () => {
        expect(country_items('eng')).toHaveLength(LULU_COUNTRIES.length)
    })

    it('names them in the requested language and sorts by that name', () => {
        const items = country_items('eng')
        const titles = items.map(item => item.title)
        expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'en')))
        expect(items.find(item => item.value === 'AU')!.title).toBe('Australia')
    })

    it('gives every item a code the quoter accepts', () => {
        for (const item of country_items('eng')){
            expect(LULU_CURRENCIES).toContain(currency_for_country(item.value))
        }
    })
})


describe('estimate_print_cost refusals', () => {

    // Each of these must refuse before the shipping request, so a book Lulu can't print never
    // costs a network round trip

    it('refuses a product Lulu does not sell', async () => {
        await expect(estimate_print_cost('not.a.real.sku.at.all', 100, 1, 'US'))
            .rejects.toThrow(NotPrintable)
    })

    it('refuses a page count below the binding\'s minimum', async () => {
        await expect(estimate_print_cost('0583X0827.BW.STD.PB.060UW444.MXX', 2, 1, 'US'))
            .rejects.toThrow(NotPrintable)
    })

    it('refuses a page count above Lulu\'s own limit', async () => {
        // Tighter than the ones printing-services models for layout
        await expect(estimate_print_cost('0583X0827.BW.STD.PB.060UW444.MXX', 99_999, 1, 'US'))
            .rejects.toThrow(NotPrintable)
    })
})
