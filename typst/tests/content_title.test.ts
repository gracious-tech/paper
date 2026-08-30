
import {describe, it, expect} from 'vitest'

import {gen_title} from '../src/content_title.js'
import {TEST_PAGE, make_title} from './fixtures.js'


// Default params matching TEST_TITLEPAGE, for tests that only vary one argument
const DEFAULTS = {
    font: 'Dancing Script',
    frame_svg: null as string|null,
    color_text: '#333333',
    color_frame: '#666666',
    text_size: 1,
    icon_size: 1,
}


describe('gen_title', () => {

    it('renders title text with Dancing Script font', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('font: "Dancing Script"')
        expect(result).toContain('Holy Bible')
    })

    it('renders subtitle', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('New International Version')
    })

    it('applies text color to title/subtitle', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            '#ff0000', DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('fill: rgb("#ff0000")')
    })

    it('escapes special characters in title', () => {
        const result = gen_title(make_title({title: 'The #1 Bible'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('\\#')
    })

    it('embeds icon SVG as an image when provided', () => {
        const result = gen_title(make_title({icon: '<svg><circle/></svg>'}), TEST_PAGE,
            DEFAULTS.font, DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame,
            DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#image.decode(bytes(')
        expect(result).toContain('<svg><circle/></svg>')
    })

    it('omits icon section when icon is null', () => {
        const result = gen_title(make_title({icon: null}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).not.toContain('#image.decode(')
    })

    it('scales icon width by the size multiplier', () => {
        // Base width is page_width / 4 = 148mm / 4 = 37mm; doubled at size 2
        const result = gen_title(make_title({icon: '<svg/>'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, 2)
        expect(result).toContain('width: 74.00mm')
    })

    it('scales title and subtitle point size together by the text-size multiplier', () => {
        // TEST_PAGE is 210mm tall → base 30pt / 15pt; halved at 0.5x
        const base = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, 1, DEFAULTS.icon_size)
        expect(base).toContain('size: 30.0pt')
        expect(base).toContain('size: 15.0pt')
        const scaled = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, 0.5, DEFAULTS.icon_size)
        expect(scaled).toContain('size: 15.0pt')
        expect(scaled).toContain('size: 7.5pt')
        // Icon width is unaffected by the text multiplier
        expect(scaled).not.toContain('size: 30.0pt')
    })

    it('renders SVG corner patterns when provided', () => {
        const svg = '<svg><rect fill="#000000"/></svg>'
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, svg,
            DEFAULTS.color_text, '#aabbcc', DEFAULTS.text_size, DEFAULTS.icon_size)
        // Should have 4 placements (4 corners)
        const place_count = (result.match(/#place\(/g) || []).length
        expect(place_count).toBe(4)
        // Should replace default color with the frame color
        expect(result).toContain('#aabbcc')
    })

    it('omits corner patterns when frame_svg is null', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, null,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).not.toContain('#place(')
    })

    it('uses mirrored scales for corners', () => {
        const svg = '<svg></svg>'
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        // Top-right: x mirrored
        expect(result).toContain('scale(x: -100%')
        // Bottom-left: y mirrored
        expect(result).toContain('scale(y: -100%')
        // Bottom-right: both mirrored
        expect(result).toContain('scale(x: -100%, y: -100%')
    })

    it('calculates pattern width as 1/3 of page width', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, '<svg></svg>',
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        // 148mm / 3 = 49.33mm
        expect(result).toContain('width: 49.33mm')
    })

    it('centers content', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('align(center')
    })

    it('vertically centers the title group as one block when there is no icon', () => {
        const result = gen_title(make_title({icon: null}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 100%, height: 100%, place(center + horizon, dy: ')
        // Only the title/subtitle gap remains — no fixed top spacer pushing the group down
        expect((result.match(/#v\(/g) || []).length).toBe(1)
    })

    it('omits the subtitle run and its gap entirely when the subtitle is empty', () => {
        const result = gen_title(make_title({icon: null, subtitle: ''}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        // No spacer at all — a lone title sits at true page centre
        expect(result).not.toContain('#v(')
        // Only the title's text run is emitted
        expect((result.match(/#text\(/g) || []).length).toBe(1)
    })

    it('drops the empty subtitle gap in the icon layout too', () => {
        const result = gen_title(make_title({icon: '<svg/>', subtitle: ''}), TEST_PAGE,
            DEFAULTS.font, DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame,
            DEFAULTS.text_size, DEFAULTS.icon_size)
        // Only the icon gap remains — no title/subtitle gap
        expect((result.match(/#v\(/g) || []).length).toBe(1)
        expect((result.match(/#text\(/g) || []).length).toBe(1)
    })

    it('caps the text column at 2/3 of the trim width', () => {
        // 148mm trim → 2/3 = 98.67mm, narrower than the 118mm content area
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 98.67mm)[')
    })

    it('never widens the text column past the live content area', () => {
        // 60mm side margins leave a 28mm content area — well under 2/3 of the trim
        const narrow = {...TEST_PAGE, margin_left: '60mm', margin_right: '60mm'}
        const result = gen_title(make_title(), narrow, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 28.00mm)[')
    })

    it('sets a fixed ~1.4x title leading and disables justification + hyphenation', () => {
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#set par(leading: 1.4em, justify: false)')
        expect(result).toContain('#set text(hyphenate: false)')
    })

    it('centres title, subtitle and icon together as one group', () => {
        const result = gen_title(make_title({icon: '<svg/>'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 100%, height: 100%, place(center + horizon, dy: ')
        // Title, subtitle, then icon in order — no leading top spacer
        expect(result.indexOf('Holy Bible')).toBeLessThan(result.indexOf('New International Version'))
        expect(result.indexOf('New International Version'))
            .toBeLessThan(result.indexOf('#image.decode('))
        // title/subtitle gap + icon gap
        expect((result.match(/#v\(/g) || []).length).toBe(2)
    })

    it('spaces the icon below the text by 6% of the trim height', () => {
        // TEST_PAGE height is 210mm → 12.60mm
        const result = gen_title(make_title({icon: '<svg/>'}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#v(12.60mm)')
    })

    it('centres a lone icon on the page when there is no title or subtitle', () => {
        const result = gen_title(make_title({icon: '<svg/>', title: '', subtitle: ''}), TEST_PAGE,
            DEFAULTS.font, DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame,
            DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('#block(width: 100%, height: 100%, place(center + horizon, dy: ')
        // No text runs and no spacers to pull the icon off centre
        expect(result).not.toContain('#text(')
        expect(result).not.toContain('#v(')
        expect(result).toContain('#image.decode(')
        // A lone icon has a true box — no optical nudge
        expect(result).toContain('place(center + horizon, dy: 0.0pt)')
    })

    it('nudges the group down to optically centre it when text leads', () => {
        // TEST_PAGE 210mm tall → title 30pt → nudge 30 * 0.35 = 10.5pt
        const result = gen_title(make_title(), TEST_PAGE, DEFAULTS.font, DEFAULTS.frame_svg,
            DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        expect(result).toContain('place(center + horizon, dy: 10.5pt)')
    })

    it('drops an empty title but keeps the subtitle above the icon', () => {
        const result = gen_title(make_title({icon: '<svg/>', title: ''}), TEST_PAGE, DEFAULTS.font,
            DEFAULTS.frame_svg, DEFAULTS.color_text, DEFAULTS.color_frame, DEFAULTS.text_size, DEFAULTS.icon_size)
        // One text run (subtitle), no title/subtitle gap — just the icon gap
        expect((result.match(/#text\(/g) || []).length).toBe(1)
        expect(result).toContain('New International Version')
        expect((result.match(/#v\(/g) || []).length).toBe(1)
        expect(result.indexOf('New International Version'))
            .toBeLessThan(result.indexOf('#image.decode('))
    })
})
