
import {describe, it, expect} from 'vitest'

import {init_fonts} from 'typst-fonts'
import {collect_fonts} from '../src/fonts.js'
import {make_request, make_title, make_passage, TEST_TYPOGRAPHY, TEST_TITLEPAGE} from './fixtures.js'


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

    it('includes the second translation\'s body and heading fonts when set apart from the '
        + 'primary fonts', () => {
        const result = collect_fonts(make_request({
            typography: {
                ...TEST_TYPOGRAPHY,
                font_text2: 'Second Body Font',
                font_headings2: 'Second Heading Font',
            },
        }))
        expect(result).toContain('Second Body Font')
        expect(result).toContain('Second Heading Font')
    })

    // The title font only loads when there's a title page for it to set
    it('includes the title-page font only when a title page is present', () => {
        const titlepage = {...TEST_TITLEPAGE, font: 'Title Only Font'}
        expect(collect_fonts(make_request({titlepage, content: [make_passage()]})))
            .not.toContain('Title Only Font')
        expect(collect_fonts(make_request({titlepage, content: [make_title(), make_passage()]})))
            .toContain('Title Only Font')
    })
})
