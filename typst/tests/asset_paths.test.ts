
import {describe, it, expect} from 'vitest'

import {design_assets_prefix, version_assets_prefix, design_cache_prefix, asset_basename,
    to_version_asset, to_design_asset, DESIGN_ASSETS, VERSION_ASSETS, DESIGN_CACHE}
    from '../src/asset_paths.js'


describe('prefixes', () => {

    it('keys every prefix by design id and ends with a separator', () => {
        expect(design_assets_prefix('abc')).toBe('design_assets/abc/')
        expect(version_assets_prefix('abc')).toBe('version_assets/abc/')
        expect(design_cache_prefix('abc')).toBe('design_cache/abc/')
    })

    it('matches the exported prefix constants', () => {
        // The Storage rules match on these top-level dirs, so the constants and the built paths
        // have to agree or a write lands somewhere no rule covers
        expect(design_assets_prefix('x').startsWith(`${DESIGN_ASSETS}/`)).toBe(true)
        expect(version_assets_prefix('x').startsWith(`${VERSION_ASSETS}/`)).toBe(true)
        expect(design_cache_prefix('x').startsWith(`${DESIGN_CACHE}/`)).toBe(true)
    })

    it('keeps the three prefixes distinct for the same design', () => {
        const prefixes = new Set([design_assets_prefix('d'), version_assets_prefix('d'),
            design_cache_prefix('d')])
        expect(prefixes.size).toBe(3)
    })

    it('passes url64 design ids through unchanged', () => {
        // Ids contain -_~ and are never escaped — the path is built by concatenation
        expect(design_assets_prefix('a-b_c~d')).toBe('design_assets/a-b_c~d/')
    })
})


describe('asset_basename', () => {

    it('returns the last path segment', () => {
        expect(asset_basename('design_assets/design1/abc123.png')).toBe('abc123.png')
    })

    it('returns the whole string when there is no separator', () => {
        expect(asset_basename('abc123.png')).toBe('abc123.png')
    })

    it('returns empty for a path ending in a separator', () => {
        expect(asset_basename('design_assets/design1/')).toBe('')
    })

    it('takes only the final segment of a deeply nested path', () => {
        expect(asset_basename('a/b/c/d/e.otf')).toBe('e.otf')
    })
})


describe('prefix swapping', () => {

    it('freezes a live asset into the design\'s version prefix', () => {
        expect(to_version_asset('design_assets/d1/hash.png', 'd1'))
            .toBe('version_assets/d1/hash.png')
    })

    it('thaws a frozen asset back into the design prefix', () => {
        expect(to_design_asset('version_assets/d1/hash.png', 'd1'))
            .toBe('design_assets/d1/hash.png')
    })

    it('round-trips a path back to itself', () => {
        const live = 'design_assets/d1/hash.png'
        expect(to_design_asset(to_version_asset(live, 'd1'), 'd1')).toBe(live)
    })

    it('re-homes an asset under a different design id', () => {
        // What "keep own copy" relies on: the basename identifies the bytes, the prefix the owner
        expect(to_version_asset('version_assets/source/hash.png', 'recipient'))
            .toBe('version_assets/recipient/hash.png')
    })

    // Path confinement — the whole reason these take only the basename. A client-written
    // blueprint can name any string as an asset path, and resolving it verbatim would let a
    // design freeze (or a copy exfiltrate) an object belonging to someone else
    describe('confinement', () => {

        const hostile = [
            '../../versions/someone_else/doc.pdf',
            '/etc/passwd',
            'design_assets/other_design/secret.png',
            'version_assets/other_design/secret.png',
            'https://example.com/evil.png',
            'design_assets/d1/../../other/secret.png',
        ]

        for (const path of hostile){
            it(`confines "${path}" to the target design's own prefix`, () => {
                const frozen = to_version_asset(path, 'mine')
                expect(frozen.startsWith('version_assets/mine/')).toBe(true)
                // And nothing of the original path survives past the basename
                expect(frozen.slice('version_assets/mine/'.length)).not.toContain('/')

                const live = to_design_asset(path, 'mine')
                expect(live.startsWith('design_assets/mine/')).toBe(true)
                expect(live.slice('design_assets/mine/'.length)).not.toContain('/')
            })
        }
    })
})
