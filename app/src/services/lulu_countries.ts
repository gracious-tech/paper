
// Destinations the Lulu cost estimate offers.
//
// Lulu's shipping quotes are priced per country and nothing else — a full street address
// returns the same figures as a bare country code (verified: Canberra, Perth and a bare "AU"
// all quote identically), so a country code is all this table needs to hold.
//
// Every code here was checked against Lulu's live `/shipping-options/` endpoint and returned
// real delivery options. Countries Lulu wouldn't quote for were dropped (Russia, Ukraine and
// Myanmar return nothing), so treat this as a verified set and re-check anything added to it.
//
// `currency` names which of Lulu's five currencies to quote a country in, and is only set
// where they actually price in the local one. Everywhere else is quoted in USD — Lulu doesn't
// publish prices in most of these countries' own currencies, and their per-currency prices are
// independently set rather than converted (see lulu_prices.ts), so there's nothing to convert.

import type {LuluCurrency} from '@/services/lulu_prices'

export interface LuluCountry {
    code:string  // ISO 3166-1 alpha-2
    currency?:LuluCurrency  // Omitted where Lulu has no price list in the local currency
}


export const LULU_COUNTRIES:LuluCountry[] = [
    {code: 'AE'},
    {code: 'AR'},
    {code: 'AT', currency: 'EUR'},
    {code: 'AU', currency: 'AUD'},
    {code: 'BD'},
    {code: 'BE', currency: 'EUR'},
    {code: 'BG'},
    {code: 'BR'},
    {code: 'CA', currency: 'CAD'},
    {code: 'CH'},
    {code: 'CI'},
    {code: 'CL'},
    {code: 'CM'},
    {code: 'CN'},
    {code: 'CO'},
    {code: 'CY', currency: 'EUR'},
    {code: 'CZ'},
    {code: 'DE', currency: 'EUR'},
    {code: 'DK'},
    {code: 'EC'},
    {code: 'EE', currency: 'EUR'},
    {code: 'EG'},
    {code: 'ES', currency: 'EUR'},
    {code: 'ET'},
    {code: 'FI', currency: 'EUR'},
    {code: 'FJ'},
    {code: 'FR', currency: 'EUR'},
    {code: 'GB', currency: 'GBP'},
    {code: 'GH'},
    {code: 'GR', currency: 'EUR'},
    {code: 'HK'},
    {code: 'HR', currency: 'EUR'},
    {code: 'HU'},
    {code: 'ID'},
    {code: 'IE', currency: 'EUR'},
    {code: 'IL'},
    {code: 'IN'},
    {code: 'IS'},
    {code: 'IT', currency: 'EUR'},
    {code: 'JP'},
    {code: 'KE'},
    {code: 'KH'},
    {code: 'KR'},
    {code: 'LK'},
    {code: 'LT', currency: 'EUR'},
    {code: 'LU', currency: 'EUR'},
    {code: 'LV', currency: 'EUR'},
    {code: 'MA'},
    {code: 'MT', currency: 'EUR'},
    {code: 'MX'},
    {code: 'MY'},
    {code: 'NG'},
    {code: 'NL', currency: 'EUR'},
    {code: 'NO'},
    {code: 'NP'},
    {code: 'NZ'},
    {code: 'PE'},
    {code: 'PG'},
    {code: 'PH'},
    {code: 'PK'},
    {code: 'PL'},
    {code: 'PT', currency: 'EUR'},
    {code: 'RO'},
    {code: 'RS'},
    {code: 'RW'},
    {code: 'SA'},
    {code: 'SE'},
    {code: 'SG'},
    {code: 'SI', currency: 'EUR'},
    {code: 'SK', currency: 'EUR'},
    {code: 'SN'},
    {code: 'TH'},
    {code: 'TR'},
    {code: 'TW'},
    {code: 'TZ'},
    {code: 'UG'},
    {code: 'US', currency: 'USD'},
    {code: 'UY'},
    {code: 'VN'},
    {code: 'ZA'},
    {code: 'ZM'},
    {code: 'ZW'},
]


// Lookup by ISO 3166-1 alpha-2 code
export function get_lulu_country(code:string):LuluCountry|null{
    return LULU_COUNTRIES.find(item => item.code === code) ?? null
}
