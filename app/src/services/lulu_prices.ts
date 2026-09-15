
// Lulu's print prices, read from the table generated at build time by app/tools/
// gen_lulu_prices.ts out of Lulu's own published spec sheet. Nothing here is hand-written:
// re-run .bin/gen_lulu_prices (or deploy, which does it for you) to pick up a re-price.
//
// A book costs `base + per_page * pages` in the chosen currency. Lulu sets each currency
// independently — they are not conversions of each other, with the AUD/USD ratio ranging from
// 1.21 to 2.11 across their catalogue — so never derive one currency from another: pick the
// currency first and read its column.

import data from '@/services/lulu_prices.json'
import {parse_pod_package_id} from '@/services/lulu_skus'


// Currencies Lulu quotes in, in the order the generated price rows list them
export const LULU_CURRENCIES = data.currencies as readonly string[]

export type LuluCurrency = 'USD'|'GBP'|'EUR'|'AUD'|'CAD'


// When the prices shipped in this build were published by Lulu, for anywhere that wants to say
// how current they are
export const LULU_PRICES_MODIFIED = data.source_modified


// The page range Lulu will print this product in, or null if it isn't one of theirs. Worth
// checking separately from printing-services' own limits, which are looser: it models what a
// binding can hold in general, while these are what Lulu will actually accept (a landscape
// perfect-bound book stops at 250 pages, not 800)
export function lulu_page_limits(pod_package_id:string):[number, number]|null{
    // Typed loosely because TS infers the generated JSON's arrays as number[], not pairs
    const limits = (data.page_limits as Record<string, number[]>)[pod_package_id]
    return limits?.[0] !== undefined && limits[1] !== undefined ? [limits[0], limits[1]] : null
}


// What Lulu charges to print one copy of this book, or null if it isn't a product they sell
export function lulu_book_price(pod_package_id:string, pages:number,
        currency:LuluCurrency):number|null{
    const parts = parse_pod_package_id(pod_package_id)
    if (!parts){
        return null
    }
    const row = (data.prices as Record<string, number[][]>)[parts.price_key]
    const price = row?.[LULU_CURRENCIES.indexOf(currency)]
    if (!price || price[0] === undefined || price[1] === undefined){
        return null
    }
    // Lulu prices to the cent, so round once here rather than letting the error ride into the
    // line total (their own quotes round the unit price, then multiply by the quantity)
    return Math.round((price[0] + price[1] * pages) * 100) / 100
}
