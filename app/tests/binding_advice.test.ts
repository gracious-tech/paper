
// Advice over a blueprint: which binding suits a document of a given length, when the length
// doesn't suit the binding chosen, and what small changes would shorten it.
//
// Nothing here may mutate a blueprint — callers apply what they're given — so every test that
// takes a patch also checks the input came back untouched.

import {describe, it, expect} from 'vitest'

import {auto_binding, binding_page_issue, page_reduction_suggestions}
    from '@/services/binding_advice'

import {make_blueprint} from './helpers/blueprint'
import {echo_t as t} from './helpers/i18n'

import type {Blueprint} from '@/services/types'


// The suggestion ids offered for a blueprint
function suggestion_ids(blueprint:Blueprint):string[]{
    return page_reduction_suggestions(blueprint, t).map(item => item.id)
}


describe('binding_page_issue', () => {

    const lulu = make_blueprint({service_id: 'lulu', binding_type: 'paperback', size_id: 'a5'})

    it('reports nothing for a length the binding takes', () => {
        expect(binding_page_issue(lulu, 200)).toBe(null)
    })

    it('reports too few pages, naming the minimum', () => {
        const issue = binding_page_issue(lulu, 2)
        expect(issue).not.toBe(null)
        expect(issue!.fewer).toBe(true)
        expect(issue!.limit).toBeGreaterThan(2)
        expect(issue!.name).toBeTruthy()
    })

    it('reports too many pages, naming the maximum', () => {
        const issue = binding_page_issue(lulu, 100_000)
        expect(issue).not.toBe(null)
        expect(issue!.fewer).toBe(false)
        expect(issue!.limit).toBeLessThan(100_000)
    })

    it('has nothing to say about home or custom printing', () => {
        // No service to ask, so no constraint to violate
        for (const service_id of ['home', 'custom']){
            expect(binding_page_issue(make_blueprint({service_id}), 100_000)).toBe(null)
        }
    })

    it('has nothing to say about a service it does not know', () => {
        expect(binding_page_issue(
            make_blueprint({service_id: 'not_a_service'}), 100_000)).toBe(null)
    })

    it('has nothing to say about a binding the service does not define', () => {
        expect(binding_page_issue(
            make_blueprint({service_id: 'lulu', binding_type: 'stapled_by_hand'}), 5)).toBe(null)
    })
})


describe('auto_binding', () => {

    it('assumes a real book when no page count is known yet', () => {
        // Most designs are whole books; a thin one is corrected as soon as the first estimate
        // lands, and erring towards the thicker binding is the safe direction
        expect(auto_binding(make_blueprint({service_id: 'lulu'}), null)).toBe('paperback')
    })

    it('prefers perfect binding at a normal length', () => {
        expect(auto_binding(make_blueprint({service_id: 'lulu'}), 200)).toBe('paperback')
    })

    it('drops to saddle stitch for a document too thin to perfect bind', () => {
        expect(auto_binding(make_blueprint({service_id: 'lulu', size_id: 'a5'}), 8))
            .toBe('paperback_stitch')
    })

    it('prefers coil when there is a blank half to write on', () => {
        // Coil lies flat under a pen
        expect(auto_binding(
            make_blueprint({service_id: 'lulu', half_blank: 'left'}), 200))
            .toBe('paperback_coil')
    })

    it('never picks saddle stitch when nothing fits', () => {
        // Past every binding's maximum: leave the top preference and let binding_page_issue
        // say that the length itself is the problem
        expect(auto_binding(make_blueprint({service_id: 'lulu'}), 100_000)).toBe('paperback')
    })

    it('leaves home and custom bindings untouched', () => {
        for (const service_id of ['home', 'custom']){
            expect(auto_binding(
                make_blueprint({service_id, binding_type: 'whatever'}), 500))
                .toBe('whatever')
        }
    })

    it('leaves the binding alone for an unknown service', () => {
        expect(auto_binding(
            make_blueprint({service_id: 'not_a_service', binding_type: 'hardcover'}), 500))
            .toBe('hardcover')
    })
})


describe('page_reduction_suggestions', () => {

    it('offers two columns when the design is single-column', () => {
        expect(suggestion_ids(make_blueprint({columns: null}))).toContain('columns')
        expect(suggestion_ids(make_blueprint({columns: false}))).toContain('columns')
    })

    it('does not offer columns when already on', () => {
        expect(suggestion_ids(make_blueprint({columns: true}))).not.toContain('columns')
    })

    it('does not offer columns when two translations already force them', () => {
        // The option is disabled in that case, so suggesting it would do nothing
        expect(suggestion_ids(make_blueprint(
            {columns: null, bibles: ['a', 'b'], bibles_layout: 'columns'})))
            .not.toContain('columns')
    })

    it('offers looser alignment only for two translations aligned by verse', () => {
        expect(suggestion_ids(make_blueprint({bibles: ['a', 'b'], bibles_align: 'verse'})))
            .toContain('bibles_align')
        expect(suggestion_ids(make_blueprint({bibles: ['a', 'b'], bibles_align: 'paragraph'})))
            .not.toContain('bibles_align')
        expect(suggestion_ids(make_blueprint({bibles: ['a'], bibles_align: 'verse'})))
            .not.toContain('bibles_align')
    })

    it('offers turning footnotes off, unless study notes already force them off', () => {
        expect(suggestion_ids(make_blueprint({show_footnotes: true, notes: null})))
            .toContain('footnotes')
        expect(suggestion_ids(make_blueprint({show_footnotes: false, notes: null})))
            .not.toContain('footnotes')
        expect(suggestion_ids(make_blueprint({show_footnotes: true, notes: 'tyndale'})))
            .not.toContain('footnotes')
    })

    describe('margins', () => {

        it('steps to the comfortable target first', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({margin_unit: 'mm', margin_top: 20, margin_bottom: 20,
                    margin_inner: 20, margin_outer: 20}), t)
                .find(item => item.id === 'margins')!
            expect(suggestion.patch).toEqual({margin_top: 12, margin_bottom: 12,
                margin_inner: 12, margin_outer: 12})
        })

        it('steps to the floor once already at the comfortable target', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({margin_unit: 'mm', margin_top: 12, margin_bottom: 12,
                    margin_inner: 12, margin_outer: 12}), t)
                .find(item => item.id === 'margins')!
            expect(suggestion.patch['margin_top']).toBe(10)
        })

        it('stops offering once at the floor', () => {
            expect(suggestion_ids(make_blueprint({margin_unit: 'mm', margin_top: 10,
                margin_bottom: 10, margin_inner: 10, margin_outer: 10})))
                .not.toContain('margins')
        })

        it('never raises a margin that is already below the target', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({margin_unit: 'mm', margin_top: 20, margin_bottom: 8,
                    margin_inner: 20, margin_outer: 20}), t)
                .find(item => item.id === 'margins')!
            expect(suggestion.patch['margin_bottom']).toBe(8)
        })

        it('uses inch targets when the design is measured in inches', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({margin_unit: 'inch', margin_top: 1, margin_bottom: 1,
                    margin_inner: 1, margin_outer: 1}), t)
                .find(item => item.id === 'margins')!
            expect(suggestion.patch['margin_top']).toBe(0.5)
            expect(suggestion.text).toContain('unit=in')
        })

        it('quotes the largest current margin, not all four', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({margin_unit: 'mm', margin_top: 25, margin_bottom: 8,
                    margin_inner: 20, margin_outer: 20}), t)
                .find(item => item.id === 'margins')!
            expect(suggestion.text).toContain('current=25')
        })
    })

    describe('line height and font size', () => {

        it('steps line height down through comfortable then floor', () => {
            const step = (line_height:number) => page_reduction_suggestions(
                make_blueprint({line_height}), t)
                .find(item => item.id === 'line_height')?.patch['line_height']
            expect(step(1.5)).toBe(1.3)
            expect(step(1.3)).toBe(1.2)
            expect(step(1.2)).toBeUndefined()
            expect(step(1.1)).toBeUndefined()
        })

        it('steps font size down through comfortable then floor', () => {
            const step = (font_size:number) => page_reduction_suggestions(
                make_blueprint({font_size}), t)
                .find(item => item.id === 'font_size')?.patch['font_size']
            expect(step(11)).toBe(9)
            expect(step(9)).toBe(8)
            expect(step(8)).toBeUndefined()
        })

        it('rounds the figure it quotes rather than printing float noise', () => {
            const suggestion = page_reduction_suggestions(
                make_blueprint({line_height: 1.3500000000000001}), t)
                .find(item => item.id === 'line_height')!
            expect(suggestion.text).toContain('current=1.35')
        })
    })

    it('offers nothing for a design already as tight as it suggests', () => {
        expect(suggestion_ids(make_blueprint({
            columns: true,
            show_footnotes: false,
            margin_unit: 'mm', margin_top: 10, margin_bottom: 10,
            margin_inner: 10, margin_outer: 10,
            line_height: 1.2,
            font_size: 8,
        }))).toEqual([])
    })

    it('never mutates the blueprint it was given', () => {
        const blueprint = make_blueprint({font_size: 11, line_height: 1.5, margin_top: 20})
        const before = structuredClone(blueprint)
        page_reduction_suggestions(blueprint, t)
        expect(blueprint).toEqual(before)
    })

    it('gives every suggestion a distinct id', () => {
        const ids = suggestion_ids(make_blueprint())
        expect(new Set(ids).size).toBe(ids.length)
    })
})
