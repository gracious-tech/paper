
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

import {resolve_icon} from '../src/icon_cache.js'


// Icons are cached module-wide by id, so every test that fetches uses an id of its own —
// reusing one would silently serve the previous test's stub
let fetch_mock:ReturnType<typeof vi.fn>


// A successful Iconify response for the given SVG body
function ok(svg:string):Response {
    return {ok: true, status: 200, statusText: 'OK', text: async () => svg} as Response
}


beforeEach(() => {
    fetch_mock = vi.fn()
    vi.stubGlobal('fetch', fetch_mock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('raw SVG input', () => {

    it('uses a raw SVG without fetching anything', async () => {
        const svg = await resolve_icon('<svg><path fill="currentColor"/></svg>', '#ff0000')
        expect(svg).toBe('<svg><path fill="#ff0000"/></svg>')
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    it('recognises a raw SVG with leading whitespace', async () => {
        await resolve_icon('  \n<svg/>', '#000000')
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    it('replaces every currentColor occurrence', async () => {
        const svg = await resolve_icon(
            '<svg><path stroke="currentColor" fill="currentColor"/></svg>', '#123456')
        expect(svg).not.toContain('currentColor')
        expect(svg.match(/#123456/g)).toHaveLength(2)
    })

    it('leaves an SVG with no currentColor untouched', async () => {
        const raw = '<svg><path fill="#abcdef"/></svg>'
        expect(await resolve_icon(raw, '#000000')).toBe(raw)
    })
})


describe('iconify ids', () => {

    it('fetches from the Iconify API and recolors the result', async () => {
        fetch_mock.mockResolvedValue(ok('<svg><path fill="currentColor"/></svg>'))
        const svg = await resolve_icon('game-icons:holy-grail-a', '#00ff00')
        expect(fetch_mock).toHaveBeenCalledWith(
            'https://api.iconify.design/game-icons/holy-grail-a.svg')
        expect(svg).toContain('#00ff00')
    })

    it('strips width and height so the renderer controls the size', async () => {
        fetch_mock.mockResolvedValue(
            ok('<svg width="24" height="24" viewBox="0 0 24 24"><path/></svg>'))
        const svg = await resolve_icon('mdi:size-strip', '#000000')
        expect(svg).not.toContain('width="24"')
        expect(svg).not.toContain('height="24"')
        expect(svg).toContain('viewBox="0 0 24 24"')
    })

    it('leaves width/height on inner elements alone', async () => {
        fetch_mock.mockResolvedValue(
            ok('<svg width="24"><rect width="10" height="10"/></svg>'))
        const svg = await resolve_icon('mdi:inner-dims', '#000000')
        expect(svg).toContain('<rect width="10" height="10"/>')
        expect(svg).not.toContain('<svg width="24">')
    })

    it('caches by id, fetching only once', async () => {
        fetch_mock.mockResolvedValue(ok('<svg><path fill="currentColor"/></svg>'))
        await resolve_icon('mdi:cached-icon', '#111111')
        const second = await resolve_icon('mdi:cached-icon', '#222222')
        expect(fetch_mock).toHaveBeenCalledTimes(1)
        // Cached raw, recolored per call — the second colour still applies
        expect(second).toContain('#222222')
    })

    it('reports a missing icon clearly', async () => {
        fetch_mock.mockResolvedValue(
            {ok: false, status: 404, statusText: 'Not Found'} as Response)
        await expect(resolve_icon('mdi:no-such-icon', '#000000'))
            .rejects.toThrow('Icon does not exist: mdi:no-such-icon')
    })

    it('reports other failures with their status', async () => {
        fetch_mock.mockResolvedValue(
            {ok: false, status: 503, statusText: 'Service Unavailable'} as Response)
        await expect(resolve_icon('mdi:flaky-icon', '#000000'))
            .rejects.toThrow('503 Service Unavailable')
    })

    it('does not cache a failed fetch', async () => {
        fetch_mock.mockResolvedValueOnce(
            {ok: false, status: 503, statusText: 'Service Unavailable'} as Response)
        await expect(resolve_icon('mdi:retry-icon', '#000000')).rejects.toThrow()
        fetch_mock.mockResolvedValueOnce(ok('<svg/>'))
        expect(await resolve_icon('mdi:retry-icon', '#000000')).toBe('<svg/>')
    })

    it('rejects an id with no collection separator', async () => {
        await expect(resolve_icon('holy-grail', '#000000'))
            .rejects.toThrow('expected "collection:name"')
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    it('rejects an id starting with the separator', async () => {
        await expect(resolve_icon(':name', '#000000')).rejects.toThrow('Invalid iconify ID')
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    it('keeps a colon in the icon name, splitting only on the first', async () => {
        fetch_mock.mockResolvedValue(ok('<svg/>'))
        await resolve_icon('coll:a:b', '#000000')
        expect(fetch_mock).toHaveBeenCalledWith('https://api.iconify.design/coll/a:b.svg')
    })
})
