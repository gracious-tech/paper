// The font pickers' items (fonts.ts): the curated fonts by group with the decorative "Styles"
// group last, then the design's uploads (which win over a curated font of the same name), then
// families from the user's other designs by name only, and an "Auto" entry for pickers that can
// fall back to the text font. fonts.ts imports its sources by relative path, so they're mocked
// by theirs rather than through the stub aliases

import {describe, it, expect, beforeEach, vi} from 'vitest'


// The curated manifest, this design's uploads and the other designs' families
const sources = vi.hoisted(() => ({
    content: {fonts: [] as {family:string, group:string}[]},
    custom_fonts: [] as {family:string}[],
    font_suggestions: {value: [] as {family:string}[]},
}))
vi.mock('../src/services/content', () => ({content: sources.content}))
vi.mock('../src/services/custom_fonts', async () => {
    const {reactive} = await import('vue')
    sources.custom_fonts = reactive([])
    return {custom_fonts: sources.custom_fonts}
})
vi.mock('../src/services/asset_suggestions', async () => {
    const {ref} = await import('vue')
    sources.font_suggestions = ref([])
    return {font_suggestions: sources.font_suggestions}
})


import {font_items, font_items_with_auto} from '@/services/fonts'
import {translate} from '@/services/i18n'


beforeEach(() => {
    sources.content.fonts = [
        {family: 'Bevan', group: 'Styles'},
        {family: 'Lora', group: 'Serif'},
        {family: 'Inter', group: 'Sans'},
        {family: 'Merriweather', group: 'Serif'},
    ]
    sources.custom_fonts.splice(0)
    sources.font_suggestions.value = []
})


describe('font_items', () => {

    // A subheader per group in manifest order, the decorative group always last
    it('groups the curated fonts, with Styles at the end', () => {
        expect(font_items.value).toEqual([
            {type: 'subheader', title: 'Serif'}, 'Lora', 'Merriweather',
            {type: 'subheader', title: 'Sans'}, 'Inter',
            {type: 'subheader', title: 'Styles'}, 'Bevan',
        ])
    })

    // An upload named like a curated font replaces it, as the generator resolves it
    it('lists uploads in their own group, hiding a curated font of the same name', () => {
        sources.custom_fonts.push({family: 'Lora'}, {family: 'Handwriting'})
        const items = font_items.value
        expect(items.filter(item => item === 'Lora')).toHaveLength(1)
        expect(items.slice(-3)).toEqual([{type: 'subheader', title: translate('svc.fonts.uploaded')},
            'Lora', 'Handwriting'])
    })

    // Other designs' families are named only (nothing to preview them with), unless already here
    it('offers families from other designs by name, unless this design has them', () => {
        sources.custom_fonts.push({family: 'Handwriting'})
        sources.font_suggestions.value = [{family: 'Handwriting'}, {family: 'Old Letters'}]
        expect(font_items.value.slice(-2)).toEqual([
            {type: 'subheader', title: translate('svc.fonts.other_designs')},
            {title: 'Old Letters', value: 'Old Letters'},
        ])
    })

    // A group whose every font is shadowed by an upload gets no empty subheader
    it('drops a group left empty by uploads', () => {
        sources.custom_fonts.push({family: 'Inter'})
        expect(font_items.value).not.toContainEqual({type: 'subheader', title: 'Sans'})
    })
})


describe('font_items_with_auto', () => {

    // A picker that can fall back to the text font leads with "Auto"
    it('leads with an Auto entry in the caller\'s language', () => {
        const items = font_items_with_auto(translate).value
        expect(items[0]).toEqual({title: translate('svc.fonts.auto_match'), value: null})
        expect(items.slice(1)).toEqual(font_items.value)
    })
})
