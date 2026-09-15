
// Printing cost estimates for versions destined for Lulu.
//
// Lulu prices a book by its POD package id — a SKU that spells out trim size, ink, quality,
// binding, paper and cover finish — plus the page count, the quantity and the destination.
// Everything but the destination is already decided by the version's blueprint.
//
// Both halves of a quote come without credentials: printing from Lulu's published prices (see
// lulu_prices.ts, regenerated from their spec sheet at build time), delivery from their
// `/shipping-options/` endpoint, which is unauthenticated, CORS-open and needs nothing but a
// country code — a street address changes nothing it quotes. That endpoint's figures are
// byte-identical to what Lulu's authenticated cost calculation bills for shipping, and the
// price table reproduces its book prices exactly, so this is the same arithmetic without the
// secret. What it can't see is sales tax and Lulu's handling fee, so the estimate is a
// pre-tax one and says so.

import {get_service} from 'printing-services'

import {LULU_CURRENCIES, lulu_book_price, lulu_page_limits} from '@/services/lulu_prices'
import {build_pod_package_id} from '@/services/lulu_skus'
import {get_lulu_country, LULU_COUNTRIES} from '@/services/lulu_countries'
import {country_namer, locale_to_bcp47} from '@/services/locale'

import type {BindingTypeId, InkTypeId, SizeId} from 'printing-services'
import type {LuluCurrency} from '@/services/lulu_prices'
import type {Blueprint} from '@/services/types'


// The Lulu POD package id for a blueprint, or null when Lulu has no such product (a custom
// trim size, or a design set up for another printing service)
export function lulu_pod_package_id(blueprint:Blueprint):string|null{
    if (blueprint.service_id !== 'lulu'){
        return null
    }
    return build_pod_package_id(blueprint.size_id, blueprint.ink_type, blueprint.binding_type,
        blueprint.paper_type)
}


// The book's binding/ink/paper spelled out in plain words, plus a cheaper binding Lulu also
// offers for this book if any — null wherever lulu_pod_package_id() would be too (a custom trim
// size, or a design set up for another printing service)
export interface PrintSpec {
    binding:string
    ink:string
    paper:string
    cheaper_binding:string|null
}

// The cheapest of a set of options that's still valid for this book and costs less than the one
// already chosen, or undefined when the current choice is already the cheapest valid one
function cheaper_option<T extends {expense:number, valid:boolean}>(
        options:T[], current:T):T|undefined{
    return options
        .filter(option => option.valid && option.expense < current.expense)
        .sort((a, b) => a.expense - b.expense)[0]
}

export function lulu_print_spec(blueprint:Blueprint, pages:number|null):PrintSpec|null{
    if (blueprint.service_id !== 'lulu'){
        return null
    }
    const lulu = get_service('lulu')
    const size_id = blueprint.size_id as SizeId
    const binding_type = blueprint.binding_type as BindingTypeId
    const ink_type = blueprint.ink_type as InkTypeId

    // Each list is scoped to what's actually compatible with the choices made so far, same as
    // OptionsPaper's own dropdowns, so a "cheaper" suggestion is never one the book can't use
    const bindings = lulu.get_binding_types(
        {all: true, ...size_id && {size: size_id}, ...pages && {pages}})
    const inks = lulu.get_ink_types({all: true, ...binding_type && {binding_type}})
    const papers = lulu.get_paper_types(
        {all: true, ...binding_type && {binding_type}, ...ink_type && {ink_type}})

    const binding = bindings.find(item => item.id === binding_type)
    const ink = inks.find(item => item.id === ink_type)
    const paper = papers.find(item => item.id === blueprint.paper_type)
    if (!binding || !ink || !paper){
        return null
    }

    const cheaper_binding = cheaper_option(bindings, binding)

    return {
        binding: binding.name,
        ink: ink.name,
        paper: paper.name,
        cheaper_binding: cheaper_binding?.name ?? null,
    }
}


// localStorage key holding the country last estimated for, so the choice carries across
// designs and sessions (the dialog is the only place the app asks where the user lives)
const COUNTRY_KEY = 'print_cost_country'


// Primary language subtag -> the country most of its speakers are in, for browsers that report
// a bare language ("es") rather than a full tag ("es-MX"). Only a fallback: a region subtag in
// the browser's own language list always wins, and the dropdown is right there either way.
// A language whose own country Lulu won't deliver to points at the nearest one it will (uk)
const LANGUAGE_COUNTRY:Record<string, string> = {
    af: 'ZA', am: 'ET', ar: 'EG', bg: 'BG', bn: 'BD', cs: 'CZ', da: 'DK', de: 'DE', el: 'GR',
    en: 'US', es: 'MX', et: 'EE', fi: 'FI', fr: 'FR', ga: 'IE', gu: 'IN', ha: 'NG', he: 'IL',
    hi: 'IN', hr: 'HR', hu: 'HU', id: 'ID', ig: 'NG', is: 'IS', it: 'IT', ja: 'JP', km: 'KH',
    kn: 'IN', ko: 'KR', lg: 'UG', lt: 'LT', lv: 'LV', ml: 'IN', mr: 'IN', ms: 'MY', mt: 'MT',
    nb: 'NO', ne: 'NP', nl: 'NL', nn: 'NO', no: 'NO', ny: 'ZM', pa: 'IN', pl: 'PL', pt: 'BR',
    ro: 'RO', rw: 'RW', si: 'LK', sk: 'SK', sl: 'SI', sn: 'ZW', so: 'KE', sr: 'RS', sv: 'SE',
    sw: 'KE', ta: 'IN', te: 'IN', th: 'TH', tl: 'PH', tr: 'TR', uk: 'PL', ur: 'PK', vi: 'VN',
    wo: 'SN', xh: 'ZA', yo: 'NG', zh: 'CN', zu: 'ZA',
}


// Best guess at where the user would have a book shipped: the country they last estimated for,
// then the region their browser language names, then the language's main country, then the US
export function guess_country():string{
    const remembered = localStorage.getItem(COUNTRY_KEY)
    if (remembered && get_lulu_country(remembered)){
        return remembered
    }
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
    // A region subtag ("en-KE") says far more about where someone is than the language does
    for (const tag of tags){
        const region = tag.split('-')[1]?.toUpperCase()
        if (region && get_lulu_country(region)){
            return region
        }
    }
    for (const tag of tags){
        const country = LANGUAGE_COUNTRY[tag.split('-')[0]?.toLowerCase() ?? '']
        if (country && get_lulu_country(country)){
            return country
        }
    }
    return 'US'
}


// Remember the country for next time (see guess_country)
export function remember_country(code:string):void{
    localStorage.setItem(COUNTRY_KEY, code)
}


// Every destination Lulu will deliver to, named in the user's own language and sorted the way
// that language sorts them
export function country_items(locale:string):{value:string, title:string}[]{
    const tag = locale_to_bcp47(locale)
    const country_name = country_namer(locale)
    const items = LULU_COUNTRIES.map(item => ({
        value: item.code,
        title: country_name(item.code),
    }))
    return items.sort((a, b) => a.title.localeCompare(b.title, tag))
}


// Which of Lulu's five currencies to quote a country in. They don't price in the local currency
// of most places they deliver to, so anywhere without one of their own is quoted in USD
export function currency_for_country(code:string):LuluCurrency{
    const currency = get_lulu_country(code)?.currency
    return currency && (LULU_CURRENCIES as readonly string[]).includes(currency)
        ? currency as LuluCurrency
        : 'USD'
}


// One of Lulu's delivery speeds, as offered for a particular destination
export interface ShippingOption {
    level:string  // Lulu's name for the speed ('MAIL', 'EXPRESS', ...)
    carrier:string  // The carrier and service actually used, e.g. "Australia Post Mail"
    cost:number
    days_min:number|null
    days_max:number|null
}


// A quote: what printing costs, what delivery costs, and what that adds up to. Excludes sales
// tax and Lulu's handling fee, neither of which is knowable without their credentials
export interface PrintCostEstimate {
    currency:LuluCurrency
    unit_cost:number
    quantity:number
    books_total:number
    shipping:ShippingOption
    alternatives:ShippingOption[]  // Other speeds offered, cheapest first
    total:number
}


// Lulu's shipping-options response, only the fields used here
interface LuluShippingOption {
    level:string
    carrier_service_name:string
    cost_excl_tax:number|null
    is_active:boolean
    total_days_min:number|null
    total_days_max:number|null
}


// Lulu's delivery speeds for one destination, cheapest first. Called straight from the browser:
// the endpoint needs no credentials, sends `access-control-allow-origin: *`, and prices purely
// by country — a street address makes no difference to what it quotes
async function get_shipping_options(pod_package_id:string, page_count:number, quantity:number,
        country:string, currency:LuluCurrency):Promise<ShippingOption[]>{
    const response = await fetch('https://api.lulu.com/shipping-options/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            currency,
            line_items: [{page_count, pod_package_id, quantity}],
            shipping_address: {country},
        }),
    })
    if (!response.ok){
        throw new Error(`Lulu shipping options failed (${response.status})`)
    }
    const options = await response.json() as LuluShippingOption[]
    return options
        .filter(item => item.is_active && item.cost_excl_tax !== null)
        .map(item => ({
            level: item.level,
            carrier: item.carrier_service_name,
            cost: item.cost_excl_tax!,
            days_min: item.total_days_min,
            days_max: item.total_days_max,
        }))
        .sort((a, b) => a.cost - b.cost)
}


// Lulu has nothing to quote for this book — the page count falls outside what the binding can
// hold, or it isn't one of their products at all
export class NotPrintable extends Error {
    override name = 'NotPrintable'
}


// Quote printing `quantity` copies of this book and delivering them to `country`, using the
// cheapest delivery speed offered there
export async function estimate_print_cost(pod_package_id:string, page_count:number,
        quantity:number, country:string):Promise<PrintCostEstimate>{
    const currency = currency_for_country(country)
    const unit_cost = lulu_book_price(pod_package_id, page_count, currency)
    const limits = lulu_page_limits(pod_package_id)
    if (unit_cost === null || !limits){
        throw new NotPrintable(`Lulu doesn't print ${pod_package_id}`)
    }
    // Lulu's real page limits are tighter than the ones printing-services models for layout
    // (a landscape perfect-bound book stops at 250 pages, not 800), so check them here too
    if (page_count < limits[0] || page_count > limits[1]){
        throw new NotPrintable(
            `${page_count} pages is outside Lulu's ${limits[0]}-${limits[1]} for this binding`)
    }
    const options = await get_shipping_options(
        pod_package_id, page_count, quantity, country, currency)
    const [shipping, ...alternatives] = options
    if (!shipping){
        throw new NotPrintable(`Lulu doesn't deliver to ${country}`)
    }
    const books_total = Math.round(unit_cost * quantity * 100) / 100
    return {
        currency,
        unit_cost,
        quantity,
        books_total,
        shipping,
        alternatives,
        total: Math.round((books_total + shipping.cost) * 100) / 100,
    }
}
