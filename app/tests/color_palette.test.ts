// The open design's own colors, offered as one-click swatches in every color picker
// (color_palette.ts): each color field that's set, in field order, without repeats

import {describe, it, expect} from 'vitest'

import {set_blue} from './stubs/state'
import {make_blueprint} from './helpers/blueprint'

import {design_colors} from '@/services/color_palette'


describe('design_colors', () => {

    // Unset fields are skipped, and a color used twice is offered once whatever its case
    it('lists the design\'s colors once each, in field order', () => {
        set_blue(make_blueprint({text_color: '#112233', titlepage_color_text: null,
            titlepage_color_icon: '#AABBCC', titlepage_color_frame: '#aabbcc',
            show_wj_color: '#112233'}))
        expect(design_colors()).toEqual(expect.arrayContaining(['#112233', '#AABBCC']))
        expect(design_colors().filter(color => color.toLowerCase() === '#aabbcc')).toHaveLength(1)
        expect(design_colors().indexOf('#112233')).toBeLessThan(design_colors().indexOf('#AABBCC'))
    })

    // A design with no colors chosen offers none
    it('offers nothing when no color is set', () => {
        set_blue(make_blueprint({text_color: null, titlepage_color_text: null,
            titlepage_color_icon: null, titlepage_color_frame: null, show_wj_color: null,
            story_emphasis_color: null} as never))
        expect(design_colors()).toEqual([])
    })
})
