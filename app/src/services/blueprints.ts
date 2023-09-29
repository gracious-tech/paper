
import {passage_obj_to_str} from '@gracious.tech/fetch-client'

import {blue, books_meta} from '@/services/state'
import {generate_token} from '@/services/utils'

import type {Blueprint, ContentItem} from '@/services/types'


// Default blueprint for 1st use, reset, and base for saved old blueprint versions
export function get_default_blueprint():Blueprint{

    return {

        title: '',

        // Printing
        paper_unit: 'mm',
        paper_width: 210,
        paper_height: 297,
        page_arrangement: 'booklet',

        // Content
        content: [
            {
                type: 'title',
                id: generate_token(),
                title: "Titus",
                subtitle: "",
                icon: '✉️',
                pattern: 'straight',
                color_primary: '#000000',
                color_secondary: '#00000044',
                alone: true,
            },
            {
                type: 'passage',
                id: generate_token(),
                book: 'tit',
                chapter_start: null,
                chapter_end: null,
                verse_start: null,
                verse_end: null,
                title: false,
            },
            {
                type: 'custom',
                id: generate_token(),
                name: "Copyright",
                html: '<p>AUTO-COPYRIGHT</p>',
                position: 'bottom',
            },
        ],
        bibles: ['eng_bsb'],
        bibles_layout: 'columns',

        // Features
        show_headings: true,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        show_footnotes: true,
        show_woj: false,
        show_lines: true,
        notes: null,
        crossref: null,
        half_blank: false,

        // Style
        font_family: "Crimson Pro",

        // Max pages 30 (15 sheets) but ideally not greater than 20 (10 sheets)
        font_size: 10,  // Pref 10, lowest 8
        line_height: 1.75,  // Pref 1.75, lowest 1.5

        justify: null,
        columns: null,

        // Spacing
        margin_unit: 'mm',
        margin_top: 10,
        margin_bottom: 10,
        margin_left: 10,
        margin_right: 10,
        margin_swap: true,
        column_gap: 5,

        // Legal
        license: 'public',
        license_attribution: '',
        app_link: true,
    }
}


// Take untrusted input and ensure a valid blueprint is returned
export function clean_blueprint(blueprint:unknown):Blueprint{
    // TODO Ensure nested items also valid
    const valid = get_default_blueprint()
    if (typeof blueprint !== 'object' || blueprint === null){
        return valid
    }
    for (const [key, val] of Object.entries(blueprint)){
        if (key in valid){
            valid[key] = val
        }
    }
    return valid
}


// Generate name for content item
export function gen_content_name(item:ContentItem):string{
    if (item.type === 'passage'){
        return passage_obj_to_str(item, books_meta.value[blue.bibles[0]]!)
    } else if (item.type === 'custom' && item.name){
        return item.name
    } else if (item.type === 'title'){
        return item.title
    }
    return "Nameless"
}
