
// Lulu's product vocabulary: how a blueprint's printing options spell out as a POD package id,
// the SKU Lulu prices and prints by.
//
// Shared deliberately — the app builds ids from it to quote a design, and app/tools/
// gen_lulu_prices.ts enumerates it to work out which products to pull prices for. Keeping one
// definition means the generated price table can never cover a different set of products than
// the app can actually produce.

import {get_service} from 'printing-services'

import type {BindingTypeId, InkTypeId, SizeId} from 'printing-services'


// Trim size component, by our size id. Lulu only prints these — a design on a custom trim size
// has no SKU and so can't be quoted
export const TRIM_SKU:Record<string, string> = {
    pocket_book: '0425X0687',
    novella: '0500X0800',
    digest: '0550X0850',
    a5: '0583X0827',
    us_trade: '0600X0900',
    royal: '0614X0921',
    executive: '0700X1000',
    crown_quarto: '0744X0968',
    small_square: '0750X0750',
    a4: '0827X1169',
    square: '0850X0850',
    us_letter: '0850X1100',
    small_landscape: '0900X0700',
    us_letter_landscape: '1100X0850',
    a4_landscape: '1169X0827',
}

// Our single ink choice maps onto two SKU components: the ink itself and the print quality
export const INK_SKU:Record<string, [string, string]> = {
    bw: ['BW', 'STD'],
    bw_premium: ['BW', 'PRE'],
    color: ['FC', 'STD'],
    color_premium: ['FC', 'PRE'],
}

export const BINDING_SKU:Record<string, string> = {
    paperback: 'PB',
    paperback_coil: 'CO',
    paperback_stitch: 'SS',
    hardcover: 'CW',
    hardcover_jacket: 'LW',
}

// Paper weight/colour, with the bulk (pages per inch) Lulu bundles into the same component
export const PAPER_SKU:Record<string, string> = {
    cream: '060UC444',
    white: '060UW444',
    white_coated: '080CW444',
}

// Cover finish, linen colour and foil colour. The blueprint doesn't model any of them (the
// cover art is ours, not Lulu's), so pick a plain default: matte, and for a linen wrap the
// black linen / black foil that binding can't go without. None of the three affects the price
const FINISH_SKU = 'MXX'
const FINISH_SKU_LINEN = 'MBB'

// Lulu charges one price up to 6x9in and another above it, with nothing in between — trim size
// otherwise doesn't affect what a book costs, so prices are keyed by band rather than by trim
const SMALL_TRIMS = ['0425X0687', '0500X0800', '0550X0850', '0583X0827', '0600X0900']


// Assemble a POD package id from a blueprint's printing options, or null when Lulu has no such
// product (a custom trim size, or an option combination they don't sell)
export function build_pod_package_id(size_id:string, ink_type:string, binding_type:string,
        paper_type:string):string|null{
    const trim = TRIM_SKU[size_id]
    const ink = INK_SKU[ink_type]
    const binding = BINDING_SKU[binding_type]
    const paper = PAPER_SKU[paper_type]
    if (!trim || !ink || !binding || !paper){
        return null
    }
    const finish = binding_type === 'hardcover_jacket' ? FINISH_SKU_LINEN : FINISH_SKU
    return `${trim}.${ink[0]}.${ink[1]}.${binding}.${paper}.${finish}`
}


// Split a POD package id into the parts that decide its price and page limits
export function parse_pod_package_id(pod_package_id:string):
        {trim:string, band:string, price_key:string}|null{
    const [trim, ink, quality, binding, paper] = pod_package_id.split('.')
    if (!trim || !ink || !quality || !binding || !paper){
        return null
    }
    const band = SMALL_TRIMS.includes(trim) ? 'S' : 'M'
    return {trim, band, price_key: `${band}.${ink}.${quality}.${binding}.${paper}`}
}


// Every product the app can put in front of a user, as POD package ids. Walks the same
// printing-services option lists that OptionsPaper offers, so combinations Lulu doesn't sell
// (a linen-wrapped pocketbook, colour on cream paper) never appear
export function list_app_pod_package_ids():string[]{
    const lulu = get_service('lulu')
    const ids:string[] = []
    for (const size of lulu.get_sizes({all: true})){
        for (const binding of lulu.get_binding_types({all: true})){
            // Not every size is offered in every binding
            if (!lulu.get_sizes({binding_type: binding.id as BindingTypeId})
                    .some(item => item.id === size.id)){
                continue
            }
            for (const ink of lulu.get_ink_types({binding_type: binding.id as BindingTypeId})){
                const papers = lulu.get_paper_types(
                    {binding_type: binding.id as BindingTypeId, ink_type: ink.id as InkTypeId})
                for (const paper of papers){
                    if (!ink.valid || !paper.valid){
                        continue
                    }
                    const id = build_pod_package_id(
                        size.id as SizeId, ink.id, binding.id, paper.id)
                    if (id){
                        ids.push(id)
                    }
                }
            }
        }
    }
    return ids
}
