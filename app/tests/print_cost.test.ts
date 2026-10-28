
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
        expect(country_items('en')).toHaveLength(LULU_COUNTRIES.length)
    })

    it('names them in the requested language and sorts by that name', () => {
        const items = country_items('en')
        const titles = items.map(item => item.title)
        expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'en')))
        expect(items.find(item => item.value === 'AU')!.title).toBe('Australia')
    })

    it('gives every item a code the quoter accepts', () => {
        for (const item of country_items('en')){
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


describe('estimate_print_cost quotes', () => {

    // A product Lulu sells, at a page count it prints
    const SKU = '0583X0827.BW.STD.PB.060UW444.MXX'

    // Lulu's shipping-options answer, in its own field names
    const option = (level:string, cost:number|null, is_active = true) => ({
        level, carrier_service_name: `${level} carrier`, cost_excl_tax: cost, is_active,
        total_days_min: 3, total_days_max: 7,
    })

    // Have Lulu's endpoint answer with these options (or a status), recording what was asked
    function stub_lulu(answer:unknown[]|number){
        const fetch_mock = vi.fn(async () => typeof answer === 'number'
            ? new Response('', {status: answer})
            : new Response(JSON.stringify(answer)))
        vi.stubGlobal('fetch', fetch_mock)
        return fetch_mock
    }

    it('adds the cheapest active delivery to the books, keeping the rest as alternatives', async () => {
        const fetch_mock = stub_lulu([option('EXPRESS', 30), option('MAIL', 5.5),
            option('GROUND', 9), option('PRIORITY', 2, false), option('UNPRICED', null)])
        const estimate = await estimate_print_cost(SKU, 100, 3, 'AU')

        // Priced in the destination's own currency column, never converted
        expect(estimate.currency).toBe(currency_for_country('AU'))
        expect(estimate.quantity).toBe(3)
        expect(estimate.books_total).toBeCloseTo(estimate.unit_cost * 3, 2)
        // Inactive and unpriced speeds are dropped; the rest run cheapest first
        expect(estimate.shipping).toEqual({level: 'MAIL', carrier: 'MAIL carrier', cost: 5.5,
            days_min: 3, days_max: 7})
        expect(estimate.alternatives.map(item => item.level)).toEqual(['GROUND', 'EXPRESS'])
        expect(estimate.total).toBeCloseTo(estimate.books_total + 5.5, 2)

        // Asked by country alone, for this product, page count and quantity
        const [url, init] = fetch_mock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://api.lulu.com/shipping-options/')
        expect(JSON.parse(init.body as string)).toEqual({
            currency: estimate.currency,
            line_items: [{page_count: 100, pod_package_id: SKU, quantity: 3}],
            shipping_address: {country: 'AU'},
        })
    })

    it('rounds totals to the cent', async () => {
        stub_lulu([option('MAIL', 4.333)])
        const estimate = await estimate_print_cost(SKU, 100, 7, 'US')
        expect(Math.round(estimate.books_total * 100)).toBe(estimate.books_total * 100)
        expect(Math.round(estimate.total * 100)).toBeCloseTo(estimate.total * 100, 6)
    })

    it('refuses a destination Lulu offers no active delivery to', async () => {
        stub_lulu([option('MAIL', 5, false)])
        await expect(estimate_print_cost(SKU, 100, 1, 'US')).rejects.toThrow(NotPrintable)
    })

    it('fails, rather than quoting, when Lulu\'s endpoint does', async () => {
        stub_lulu(503)
        const error = await estimate_print_cost(SKU, 100, 1, 'US').catch((caught:unknown) => caught)
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toBeInstanceOf(NotPrintable)
        expect((error as Error).message).toMatch(/503/)
    })
})
