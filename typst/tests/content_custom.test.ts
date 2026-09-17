
import {describe, it, expect} from 'vitest'

import {gen_custom} from '../src/content_custom.js'
import {make_custom} from './fixtures.js'


describe('gen_custom', () => {

    it('renders content at top position directly', () => {
        const result = gen_custom(make_custom({
            position: 'top',
            content: 'Top content here',
        }), '10pt')
        expect(result).toContain('Top content here')
        // Grouped so the heading rules don't leak into the rest of the document
        expect(result.startsWith('#[')).toBe(true)
        expect(result.endsWith(']')).toBe(true)
    })

    it('scopes heading rules to the content at every position', () => {
        for (const position of ['top', 'middle', 'bottom'] as const) {
            const result = gen_custom(make_custom({position, content: '= Heading'}), '10pt')
            // Spacing values are a design choice still open to tuning — only the rule is asserted
            expect(result).toMatch(/#show heading: set block\(above: [\d.]+em, below: [\d.]+em\)/)
            // Headings render at regular weight so the editor's bold button can be un-toggled
            expect(result).toContain('#show heading: set text(weight: "regular", size: 10pt)')
        }
    })

    it('pins heading sizes to multiples of the body size, not em', () => {
        const result = gen_custom(make_custom({position: 'top', content: '= H'}), '12pt')
        // Body-relative, since an em inside a heading rule compounds on the size it replaces
        expect(result).toContain('#show heading.where(level: 1): set text(size: 1.4 * 12pt)')
        expect(result).toContain('#show heading.where(level: 2): set text(size: 1.2 * 12pt)')
        // Levels the editor can't produce fall back to body size via the blanket rule
        expect(result).not.toContain('level: 3')
    })

    it('renders content at middle with vertical centering', () => {
        const result = gen_custom(make_custom({
            position: 'middle',
            content: 'Middle content',
        }), '10pt')
        // Measures the content and centres it when it fits, else lets it flow across pages
        expect(result).toContain('measure(box(width: size.width, body))')
        expect(result).toContain('align(horizon, body)')
        expect(result).toContain('Middle content')
    })

    it('renders content at bottom with bottom alignment', () => {
        const result = gen_custom(make_custom({
            position: 'bottom',
            content: 'Bottom content',
        }), '10pt')
        expect(result).toContain('measure(box(width: size.width, body))')
        expect(result).toContain('align(bottom, body)')
        expect(result).toContain('Bottom content')
    })

    it('falls back to normal flow when content is taller than the page', () => {
        const result = gen_custom(make_custom({position: 'middle', content: 'x'}), '10pt')
        // The else branch renders the raw body so it can break across pages
        expect(result).toContain('} else {')
        expect(result).toContain('body')
    })

    it('preserves Typst markup in content', () => {
        const content = '#text(weight: "bold")[Hello] #emph[world]'
        const result = gen_custom(make_custom({position: 'top', content}), '10pt')
        expect(result).toContain(content)
    })
})
