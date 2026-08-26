
import {describe, it, expect} from 'vitest'

import {cover_render_key, cover_config_schema, KNOWN_BUILTIN_BACKGROUNDS, STOCK_BG_PHOTOS}
    from '../src/index.js'

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

    it('rejects a builtin id outside the known allowlist', () => {
        const result = cover_config_schema.safeParse(
            make_cover({kind: 'builtin', id: 'not_a_real_file.jpg'}))
        expect(result.success).toBe(false)
    })

    it('rejects a path-traversal attempt disguised as a builtin id', () => {
        const result = cover_config_schema.safeParse(
            make_cover({kind: 'builtin', id: '../../etc/passwd'}))
        expect(result.success).toBe(false)
    })

    it('rejects the old flat bg_image_path/bg_image_hash shape', () => {
        const old_shape = {form: {}, bg_image_path: 'some/path.jpg', bg_image_hash: 'h',
            font_families: []}
        const result = cover_config_schema.safeParse(old_shape)
        expect(result.success).toBe(false)
    })

    it('every KNOWN_BUILTIN_BACKGROUNDS entry parses as a valid builtin', () => {
        for (const id of KNOWN_BUILTIN_BACKGROUNDS){
            const result = cover_config_schema.safeParse(make_cover({kind: 'builtin', id}))
            expect(result.success).toBe(true)
        }
    })

})
