
import {describe, it, expect} from 'vitest'

import {gen_custom} from '../src/content_custom.js'
import {make_custom} from './fixtures.js'


describe('gen_custom', () => {

    it('renders content at top position directly', () => {
        const result = gen_custom(make_custom({
            position: 'top',
            content: 'Top content here',
        }))
        expect(result).toBe('Top content here')
    })

    it('renders content at middle with vertical centering', () => {
        const result = gen_custom(make_custom({
            position: 'middle',
            content: 'Middle content',
        }))
        // Measures the content and centres it when it fits, else lets it flow across pages
        expect(result).toContain('measure(box(width: size.width, body))')
        expect(result).toContain('align(horizon, body)')
        expect(result).toContain('Middle content')
    })

    it('renders content at bottom with bottom alignment', () => {
        const result = gen_custom(make_custom({
            position: 'bottom',
            content: 'Bottom content',
        }))
        expect(result).toContain('measure(box(width: size.width, body))')
        expect(result).toContain('align(bottom, body)')
        expect(result).toContain('Bottom content')
    })

    it('falls back to normal flow when content is taller than the page', () => {
        const result = gen_custom(make_custom({position: 'middle', content: 'x'}))
        // The else branch renders the raw body so it can break across pages
        expect(result).toContain('} else {')
        expect(result).toContain('body')
    })

    it('preserves Typst markup in content', () => {
        const content = '#text(weight: "bold")[Hello] #emph[world]'
        const result = gen_custom(make_custom({position: 'top', content}))
        expect(result).toBe(content)
    })
})
