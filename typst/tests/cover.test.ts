
import {describe, it, expect} from 'vitest'

import {cover_render_key, cover_config_schema, cover_form_for_render,
    KNOWN_BUILTIN_BACKGROUNDS, STOCK_BG_PHOTOS} from '../src/index.js'

import type {Blueprint, CoverConfig} from '../src/types.js'


const minimal_blueprint =
    {size_id: '', service_id: 'home', binding_type: '', bibles: ['eng']} as unknown as Blueprint

const make_cover = (bg_image:CoverConfig['bg_image']):CoverConfig =>
    ({form: {}, bg_image, font_families: []})


describe('cover_render_key', () => {

    it('distinguishes two different builtins', () => {
        const a = cover_render_key(make_cover({kind: 'builtin', id: 'a.jpg'}), minimal_blueprint, 100)
        const b = cover_render_key(make_cover({kind: 'builtin', id: 'b.jpg'}), minimal_blueprint, 100)
        expect(a).not.toBe(b)
    })

    it('distinguishes two customs with different hashes', () => {
        const a = cover_render_key(
            make_cover({kind: 'custom', path: 'p1', hash: 'x'}), minimal_blueprint, 100)
        const b = cover_render_key(
            make_cover({kind: 'custom', path: 'p2', hash: 'y'}), minimal_blueprint, 100)
        expect(a).not.toBe(b)
    })

    it('collapses two customs sharing a hash but different paths (preserves dedup)', () => {
        const a = cover_render_key(
            make_cover({kind: 'custom', path: 'p1', hash: 'x'}), minimal_blueprint, 100)
        const b = cover_render_key(
            make_cover({kind: 'custom', path: 'p2', hash: 'x'}), minimal_blueprint, 100)
        expect(a).toBe(b)
    })

    it('distinguishes a builtin from a custom even with a coincidentally matching identifier', () => {
        const builtin = cover_render_key(
            make_cover({kind: 'builtin', id: 'x'}), minimal_blueprint, 100)
        const custom = cover_render_key(
            make_cover({kind: 'custom', path: 'p', hash: 'x'}), minimal_blueprint, 100)
        expect(builtin).not.toBe(custom)
    })

})


describe('cover_form_for_render size_mode', () => {

    // Two independent reasons a cover has no named size, and missing either one sends bookcover
    // a preset size the blueprint isn't actually using

    it('is custom when the blueprint has no named size', () => {
        const form = cover_form_for_render(make_cover(null), minimal_blueprint, 100)
        expect(form['size_mode']).toBe('custom')
    })

    it('is custom for a booklet even when a named size is set', () => {
        // A booklet's chosen size is the sheet that gets folded, so the cover must wrap a
        // reading page (half of it) — dimensions no named size can express
        const booklet = {...minimal_blueprint, size_id: 'a5', booklet: true} as Blueprint
        const form = cover_form_for_render(make_cover(null), booklet, 100)
        expect(form['size_mode']).toBe('custom')
    })

    it('is preset for a non-booklet with a named size', () => {
        const preset = {...minimal_blueprint, size_id: 'a5', booklet: false} as Blueprint
        const form = cover_form_for_render(make_cover(null), preset, 100)
        expect(form['size_mode']).toBe('preset')
        expect(form['size_id']).toBe('a5')
    })

})


describe('cover_config_schema', () => {

    it('accepts a valid builtin bg_image', () => {
        const filename = STOCK_BG_PHOTOS[0]!
        const result = cover_config_schema.safeParse(make_cover({kind: 'builtin', id: filename}))
        expect(result.success).toBe(true)
    })

    it('accepts a valid custom bg_image', () => {
        const result = cover_config_schema.safeParse(
            make_cover({kind: 'custom', path: 'user_cover_images/u/h.jpg', hash: 'h'}))
        expect(result.success).toBe(true)
    })

    it('accepts a null bg_image', () => {
        const result = cover_config_schema.safeParse(make_cover(null))
        expect(result.success).toBe(true)
    })

    it('accepts a builtin bookcover publishes but this app never seeds from', () => {
        // KNOWN_BUILTIN_BACKGROUNDS is the curated set the wizard seeds from, not a validator:
        // the user can pick any background bookcover publishes inside the cover widget, and
        // rejecting those would force them to be stored as private uploads instead
        const id = 'some_other_published_background.jpg'
        expect(KNOWN_BUILTIN_BACKGROUNDS.has(id)).toBe(false)
        const result = cover_config_schema.safeParse(make_cover({kind: 'builtin', id}))
        expect(result.success).toBe(true)
        expect(result.data?.bg_image).toEqual({kind: 'builtin', id})
    })

    it('drops a path-traversal attempt disguised as a builtin id', () => {
        const result = cover_config_schema.safeParse(
            make_cover({kind: 'builtin', id: '../../etc/passwd'}))
        // The cover survives without its background rather than being discarded whole — the
        // traversal string itself never reaches the config
        expect(result.success).toBe(true)
        expect(result.data?.bg_image).toBe(null)
    })

    it('drops a builtin id that is not an image filename', () => {
        const result = cover_config_schema.safeParse(
            make_cover({kind: 'builtin', id: 'not_an_image.txt'}))
        expect(result.success).toBe(true)
        expect(result.data?.bg_image).toBe(null)
    })

    it('drops the old flat bg_image_path/bg_image_hash shape', () => {
        const old_shape = {form: {}, bg_image_path: 'some/path.jpg', bg_image_hash: 'h',
            font_families: []}
        const result = cover_config_schema.safeParse(old_shape)
        expect(result.success).toBe(true)
        expect(result.data?.bg_image).toBe(null)
    })

    it('every KNOWN_BUILTIN_BACKGROUNDS entry parses as a valid builtin', () => {
        for (const id of KNOWN_BUILTIN_BACKGROUNDS){
            const result = cover_config_schema.safeParse(make_cover({kind: 'builtin', id}))
            expect(result.success).toBe(true)
        }
    })

})
