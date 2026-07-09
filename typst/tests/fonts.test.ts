
import {describe, it, expect} from 'vitest'

import {init_fonts} from 'typst-fonts'
import {collect_fonts} from '../src/fonts.js'
import {make_request, TEST_TYPOGRAPHY} from './fixtures.js'


describe('collect_fonts', () => {

    init_fonts({font_manifest: [
        {family: 'Noto Serif', group: 'Noto', style: 'serif',
            files: ['NotoSerif-Regular.ttf'], preview_file: 'NotoSerif-Regular.ttf'},
        {family: 'Noto Sans', group: 'Noto', style: 'sans',
            files: ['NotoSans-Regular.ttf'], preview_file: 'NotoSans-Regular.ttf'},
    ]})

    it('keeps a Noto-manifest-only fallback family (not in the curated manifest)', () => {
        const result = collect_fonts(make_request({
            typography: {...TEST_TYPOGRAPHY, font_fallbacks: ['Noto Serif Hebrew']},
        }))
        expect(result).toContain('Noto Serif Hebrew')
    })

    it('drops a fallback family resolvable to neither manifest', () => {
        const result = collect_fonts(make_request({
            typography: {...TEST_TYPOGRAPHY, font_fallbacks: ['Not A Real Font']},
        }))
        expect(result).not.toContain('Not A Real Font')
    })
})
