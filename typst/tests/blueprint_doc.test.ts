
import {describe, it, expect} from 'vitest'

import {split_blueprint_doc, join_blueprint_doc, resolve_design_name, get_cover_title,
    get_cover_title_from_form, COVER_TITLE_KEY} from '../src/blueprint_doc.js'
import {SCHEMA_VERSION} from '../src/consts.js'

import {make_blueprint} from './fixtures.js'

import type {Blueprint, ContentItem, CoverConfig} from '../src/types.js'


// A minimal content item of each kind, keyed by id so ordering can be asserted
function item(id:string):ContentItem {
    return {type: 'title', id, title: `Title ${id}`, title_subtitle: '', title_icon: null}
}


// A cover whose form carries the given title lines
function cover_with(form:Record<string, unknown>):CoverConfig {
    return {form, bg_image: null, font_families: [], title_custom: false}
}


describe('get_cover_title_from_form', () => {

    it('joins all three title lines with spaces', () => {
        expect(get_cover_title_from_form({title1: 'Holy', title2: 'Bible', title3: 'NIV'}))
            .toBe('Holy Bible NIV')
    })

    it('skips blank lines rather than leaving double spaces', () => {
        expect(get_cover_title_from_form({title1: 'Holy', title2: '', title3: 'Bible'}))
            .toBe('Holy Bible')
    })

    it('collapses runs of spaces', () => {
        expect(get_cover_title_from_form({title1: 'Holy  ', title2: '  Bible'})).toBe('Holy Bible')
    })

    it('returns empty for a form with no title lines', () => {
        expect(get_cover_title_from_form({})).toBe('')
    })

    it('ignores non-string values rather than stringifying them', () => {
        // The form is an opaque widget snapshot, so a co-editor could store anything here
        expect(get_cover_title_from_form({title1: 42, title2: null, title3: {a: 1}})).toBe('')
    })

    it('ignores a fourth line the widget does not lay out', () => {
        expect(get_cover_title_from_form({title1: 'A', title4: 'B'})).toBe('A')
    })

    it('names the first line as the one a design name is written into', () => {
        expect(COVER_TITLE_KEY).toBe('title1')
        expect(get_cover_title_from_form({[COVER_TITLE_KEY]: 'Named'})).toBe('Named')
    })
})


describe('get_cover_title', () => {

    it('reads the title out of a cover config', () => {
        expect(get_cover_title(cover_with({title1: 'Psalms'}))).toBe('Psalms')
    })

    it('returns empty when there is no cover', () => {
        expect(get_cover_title(null)).toBe('')
        expect(get_cover_title(undefined)).toBe('')
    })
})


describe('resolve_design_name', () => {

    it('prefers the explicit name', () => {
        expect(resolve_design_name('Mine', 'Cover', 'Auto')).toBe('Mine')
    })

    it('falls back to the cover title', () => {
        expect(resolve_design_name('', 'Cover', 'Auto')).toBe('Cover')
    })

    it('falls back to the derived name last', () => {
        expect(resolve_design_name('', '', 'Auto')).toBe('Auto')
    })

    it('treats a whitespace-only name as absent', () => {
        expect(resolve_design_name('   ', 'Cover', 'Auto')).toBe('Cover')
    })

    it('trims whatever it returns', () => {
        expect(resolve_design_name('  Mine  ', '', '')).toBe('Mine')
    })

    it('returns empty when every source is blank', () => {
        expect(resolve_design_name('', '', '')).toBe('')
    })
})


describe('split_blueprint_doc', () => {

    it('lifts name and content out of the options map', () => {
        const fields = split_blueprint_doc(make_blueprint({name: 'Mine', content: [item('a')]}))
        expect(fields.name).toBe('Mine')
        expect(fields.blueprint['name']).toBeUndefined()
        expect(fields.blueprint['content']).toBeUndefined()
        expect(fields.blueprint['font_size']).toBe(10)
    })

    it('keys content items by id and records their order separately', () => {
        const fields = split_blueprint_doc(
            make_blueprint({content: [item('b'), item('a'), item('c')]}))
        expect(fields.content_order).toEqual(['b', 'a', 'c'])
        expect(Object.keys(fields.content_items).sort()).toEqual(['a', 'b', 'c'])
        expect(fields.content_items['a']!.id).toBe('a')
    })

    it('handles empty content', () => {
        const fields = split_blueprint_doc(make_blueprint({content: []}))
        expect(fields.content_items).toEqual({})
        expect(fields.content_order).toEqual([])
    })

    // The rules only require a version's blueprint to be a map, so the server hands frozen docs
    // straight in — a malformed one must degrade, not throw
    it('degrades a missing content array to empty', () => {
        const fields = split_blueprint_doc({} as unknown as Blueprint)
        expect(fields.content_items).toEqual({})
        expect(fields.content_order).toEqual([])
        expect(fields.name).toBe('')
    })

    it('degrades a non-array content field to empty', () => {
        const fields = split_blueprint_doc(
            {content: 'nope', name: 'x'} as unknown as Blueprint)
        expect(fields.content_order).toEqual([])
        expect(fields.name).toBe('x')
    })

    it('degrades a non-string name to empty', () => {
        const fields = split_blueprint_doc({name: 42, content: []} as unknown as Blueprint)
        expect(fields.name).toBe('')
    })
})


describe('join_blueprint_doc', () => {

    it('is the inverse of split_blueprint_doc', () => {
        const original = make_blueprint({name: 'Mine', content: [item('a'), item('b')]})
        const rejoined = join_blueprint_doc(
            {...split_blueprint_doc(original), schema: SCHEMA_VERSION})
        expect(rejoined).toEqual(original)
    })

    it('restores content in the order array\'s order, not the map\'s', () => {
        const fields = split_blueprint_doc(
            make_blueprint({content: [item('a'), item('b'), item('c')]}))
        fields.content_order = ['c', 'a', 'b']
        const rejoined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(rejoined.content.map(i => i.id)).toEqual(['c', 'a', 'b'])
    })

    // Co-editors write these two fields independently, so they can disagree mid-sync
    it('drops an ordered id that has no item (a concurrent delete)', () => {
        const fields = split_blueprint_doc(make_blueprint({content: [item('a')]}))
        fields.content_order = ['a', 'missing']
        const rejoined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(rejoined.content.map(i => i.id)).toEqual(['a'])
    })

    it('drops an item the order array does not mention', () => {
        const fields = split_blueprint_doc(make_blueprint({content: [item('a'), item('b')]}))
        fields.content_order = ['a']
        const rejoined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(rejoined.content.map(i => i.id)).toEqual(['a'])
    })

    it('renders a duplicate ordered id twice rather than dropping it', () => {
        const fields = split_blueprint_doc(make_blueprint({content: [item('a')]}))
        fields.content_order = ['a', 'a']
        const rejoined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(rejoined.content.map(i => i.id)).toEqual(['a', 'a'])
    })
})
