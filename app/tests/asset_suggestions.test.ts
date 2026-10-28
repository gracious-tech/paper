// Reusing a font or cover background from the user's other designs (asset_suggestions.ts): what
// is offered (never the open design's own, nothing it already has, no repeats, a capped number
// of backgrounds, newest designs first) and what adopting a font does

import {describe, it, expect, beforeEach, vi} from 'vitest'

import type {StoredFontMeta} from 'paper-bible-typst'


// The user's designs, newest-modified first, and which is open
const designs_state = vi.hoisted(() => ({designs: null as unknown, current: null as unknown}))
vi.mock('@/services/designs', async () => {
    const {reactive: make_reactive, ref: make_ref} = await import('vue')
    designs_state.designs = make_reactive([])
    designs_state.current = make_ref(null)
    return {designs: designs_state.designs, current_design_id: designs_state.current}
})

// Loading another design's font bytes, and adding them to this one
const load_font_from_meta = vi.hoisted(() => vi.fn(async (meta:StoredFontMeta) =>
    ({family: meta.family, style: meta.style, files: [new Uint8Array([1])]})))
const add_design_fonts = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/services/custom_fonts', () => ({load_font_from_meta, add_design_fonts}))
vi.mock('@/services/design_assets', () => ({storage_public_url: (path:string) => `url:${path}`}))

const {font_suggestions, cover_bg_suggestions, adopt_font}
    = await import('@/services/asset_suggestions')


// What a design carries for these purposes
interface FakeDesign {
    id:string
    name:string
    assets:{fonts:StoredFontMeta[], cover_bg:{path:string, hash:string}|null}
}

const designs = designs_state.designs as FakeDesign[]
const current = designs_state.current as {value:string|null}


// A design holding the given fonts (by family) and optionally a background (by hash)
function design(id:string, families:string[], bg_hash?:string, name = `Design ${id}`):FakeDesign{
    return {id, name, assets: {
        fonts: families.map(family =>
            ({family, style: 'serif', files: [`design_assets/${id}/${family}.bin`]})),
        cover_bg: bg_hash ? {path: `design_assets/${id}/${bg_hash}.jpg`, hash: bg_hash} : null,
    }}
}


// Replace the design list, and open the first one
function set_designs(...list:FakeDesign[]):void{
    designs.splice(0, designs.length, ...list)
    current.value = list[0]?.id ?? null
}


beforeEach(() => {
    set_designs()
    load_font_from_meta.mockClear()
    add_design_fonts.mockClear()
})


describe('font_suggestions', () => {

    // Families from other designs, once each, skipping any the open design already has
    it('offers other designs\' families once each, minus the open design\'s own', () => {
        set_designs(design('open', ['Bevan']), design('a', ['Bevan', 'Lora']),
            design('b', ['Lora', 'Inter']))
        expect(font_suggestions.value.map(font => font.family)).toEqual(['Lora', 'Inter'])
        // The first design to hold a family is the one whose copy is offered
        expect(font_suggestions.value[0]!.files).toEqual(['design_assets/a/Lora.bin'])
    })

    // With nothing open, every design's fonts are suggestions
    it('offers everything when no design is open', () => {
        set_designs(design('a', ['Lora']))
        current.value = null
        expect(font_suggestions.value.map(font => font.family)).toEqual(['Lora'])
    })

})


describe('cover_bg_suggestions', () => {

    // Each other design's uploaded background, deduped by content, labelled by design name
    it('offers other designs\' backgrounds once each, with a url and a label', () => {
        set_designs(design('open', [], 'mine'), design('a', [], 'mine'), design('b', [], 'sky'),
            design('c', [], 'sky'), design('d', []), design('e', [], 'sea', ''))
        expect(cover_bg_suggestions.value).toEqual([
            {path: 'design_assets/b/sky.jpg', hash: 'sky', url: 'url:design_assets/b/sky.jpg',
                label: 'Design b'},
            // An unnamed design still needs something to show
            {path: 'design_assets/e/sea.jpg', hash: 'sea', url: 'url:design_assets/e/sea.jpg',
                label: expect.any(String)},
        ])
        expect(cover_bg_suggestions.value[1]!.label).not.toBe('')
    })

    // Each is a full-resolution photo shown as a thumbnail, so the list stops at twelve
    it('caps the suggestions at the twelve most recent designs\' backgrounds', () => {
        set_designs(design('open', []),
            ...Array.from({length: 15}, (_, i) => design(`d${i}`, [], `bg${i}`)))
        expect(cover_bg_suggestions.value.map(bg => bg.hash))
            .toEqual(Array.from({length: 12}, (_, i) => `bg${i}`))
    })

})


describe('adopt_font', () => {

    // The bytes come through the browser and are added to the design like an upload
    it('loads the family\'s bytes and adds them to the given design', async () => {
        const font:StoredFontMeta = {family: 'Lora', style: 'serif',
            files: ['design_assets/a/x.bin']}
        await adopt_font(font, 'open')
        expect(load_font_from_meta).toHaveBeenCalledWith(font)
        expect(add_design_fonts).toHaveBeenCalledWith('open',
            [{family: 'Lora', style: 'serif', files: [new Uint8Array([1])]}])
    })

})
