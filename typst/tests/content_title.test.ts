
import {describe, it, expect} from 'vitest'

import {gen_title} from '../src/content_title.js'
import {TEST_PAGE, make_title} from './fixtures.js'


describe('gen_title', () => {

    it('renders title text with Dancing Script font', () => {
        const result = gen_title(make_title(), TEST_PAGE)
        expect(result).toContain('font: "Dancing Script"')
        expect(result).toContain('Holy Bible')
    })

    it('renders subtitle', () => {
        const result = gen_title(make_title(), TEST_PAGE)
        expect(result).toContain('New International Version')
    })

    it('applies primary color to text', () => {
        const result = gen_title(make_title({color_primary: '#ff0000'}), TEST_PAGE)
        expect(result).toContain('fill: rgb("#ff0000")')
    })

    it('escapes special characters in title', () => {
        const result = gen_title(make_title({title: 'The #1 Bible'}), TEST_PAGE)
        expect(result).toContain('\\#')
    })

    it('embeds icon SVG as an image when provided', () => {
        const result = gen_title(make_title({icon: '<svg><circle/></svg>'}), TEST_PAGE)
        expect(result).toContain('#image.decode(bytes(')
        expect(result).toContain('<svg><circle/></svg>')
    })

    it('omits icon section when icon is null', () => {
        const result = gen_title(make_title({icon: null}), TEST_PAGE)
        expect(result).not.toContain('#image.decode(')
    })

    it('scales icon width by the size multiplier', () => {
        // Base width is page_width / 4 = 148mm / 4 = 37mm; doubled at size 2
        const result = gen_title(make_title({icon: '<svg/>', icon_size: 2}), TEST_PAGE)
        expect(result).toContain('width: 74.00mm')
    })

    it('renders SVG corner patterns when provided', () => {
        const svg = '<svg><rect fill="#000000"/></svg>'
        const result = gen_title(make_title({
            pattern_svg: svg,
            color_secondary: '#aabbcc',
        }), TEST_PAGE)
        // Should have 4 placements (4 corners)
        const place_count = (result.match(/#place\(/g) || []).length
        expect(place_count).toBe(4)
        // Should replace default color with secondary
        expect(result).toContain('#aabbcc')
    })

    it('omits corner patterns when pattern_svg is null', () => {
        const result = gen_title(make_title({pattern_svg: null}), TEST_PAGE)
        expect(result).not.toContain('#place(')
    })

    it('uses mirrored scales for corners', () => {
        const svg = '<svg></svg>'
        const result = gen_title(make_title({pattern_svg: svg}), TEST_PAGE)
        // Top-right: x mirrored
        expect(result).toContain('scale(x: -100%')
        // Bottom-left: y mirrored
        expect(result).toContain('scale(y: -100%')
        // Bottom-right: both mirrored
        expect(result).toContain('scale(x: -100%, y: -100%')
    })

    it('calculates pattern width as 1/3 of page width', () => {
        const result = gen_title(make_title({
            pattern_svg: '<svg></svg>',
        }), TEST_PAGE)
        // 148mm / 3 = 49.33mm
        expect(result).toContain('width: 49.33mm')
    })

    it('centers content', () => {
        const result = gen_title(make_title(), TEST_PAGE)
        expect(result).toContain('#align(center)')
    })
})
