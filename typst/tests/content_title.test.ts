
import {describe, it, expect} from 'vitest'

import {gen_title} from '../src/content_title.js'
import {TEST_PAGE, make_title} from './fixtures.js'


// Default params matching TEST_TITLEPAGE, for tests that only vary one argument
const DEFAULTS = {
    font: 'Dancing Script',
    frame_svg: null as string|null,
    color_text: '#333333',
    color_frame: '#666666',
    icon_size: 1,
}


describe('gen_title', () => {

    it('renders title text with Dancing Script font', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('font: "Dancing Script"')
        expect(result).toContain('Holy Bible')
    })

    it('renders subtitle', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('New International Version')
    })

    it('applies text color to title/subtitle', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            '#ff0000', DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('fill: rgb("#ff0000")')
    })

    it('escapes special characters in title', () => {
        const result = gen_title(make_title({title: 'The #1 Bible'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('\\#')
    })

    it('embeds icon SVG as an image when provided', () => {
        const result = gen_title(make_title({icon: '<svg><circle/></svg>'}), TEST_PAGE,
            DEFAULTS.font, DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame,
            DEFAULTS.icon_size)
        expect(result).toContain('#image.decode(bytes(')
        expect(result).toContain('<svg><circle/></svg>')
    })

    it('omits icon section when icon is null', () => {
        const result = gen_title(make_title({icon: null}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).not.toContain('#image.decode(')
    })

    it('scales icon width by the size multiplier', () => {
        // Base width is page_width / 4 = 148mm / 4 = 37mm; doubled at size 2
        const result = gen_title(make_title({icon: '<svg/>'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, 2)
        expect(result).toContain('width: 74.00mm')
    })

    it('renders SVG corner patterns when provided', () => {
        const svg = '<svg><rect fill="#000000"/></svg>'
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, svg,
            DEFAULTS.color_text, '#aabbcc', DEFAULTS.icon_size)
        // Should have 4 placements (4 corners)
        const place_count = (result.match(/#place\(/g) || []).length
        expect(place_count).toBe(4)
        // Should replace default color with the frame color
        expect(result).toContain('#aabbcc')
    })

    it('omits corner patterns when frame_svg is null', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, null,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).not.toContain('#place(')
    })

    it('uses mirrored scales for corners', () => {
        const svg = '<svg></svg>'
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        // Top-right: x mirrored
        expect(result).toContain('scale(x: -100%')
        // Bottom-left: y mirrored
        expect(result).toContain('scale(y: -100%')
        // Bottom-right: both mirrored
        expect(result).toContain('scale(x: -100%, y: -100%')
    })

    it('calculates pattern width as 1/3 of page width', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, '<svg></svg>',
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        // 148mm / 3 = 49.33mm
        expect(result).toContain('width: 49.33mm')
    })

    it('centers content', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('align(center')
    })

    it('vertically centers the title group as one block when there is no icon', () => {
        const result = gen_title(make_title({icon: null}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 100%, height: 100%, align(center + horizon)[')
        // Only the title/subtitle gap remains — no fixed top spacer pushing the group down
        expect((result.match(/#v\(/g) || []).length).toBe(1)
    })

    it('top-weights the text and keeps the icon below it when an icon is present', () => {
        const result = gen_title(make_title({icon: '<svg/>'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.icon_size)
        expect(result).not.toContain('horizon')
        // Leading spacer then title, subtitle, mid spacer, icon in order
        expect(result.indexOf('#v(')).toBeLessThan(result.indexOf('Holy Bible'))
        expect(result.indexOf('New International Version'))
            .toBeLessThan(result.indexOf('#image.decode('))
    })
})
