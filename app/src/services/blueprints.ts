
import {PassageReference} from '@gracious.tech/fetch-client'
import {cloneDeep} from 'lodash-es'

import {content} from '@/services/content'
import {blue} from '@/services/state'
import {generate_token} from '@/services/utils'

import type {Blueprint, ContentItem} from '@/services/types'


// Default blueprint for 1st use, reset, and base for saved old blueprint versions
export function get_default_blueprint():Blueprint{

    return {

        title: '',

        // Printing
        service_id: 'home',
        size_id: 'a4',
        page_count: 300,
        binding_type: 'paperback',
        ink_type: 'bw',
        paper_type: 'white',
        custom_unit: 'mm',
        custom_trim_width: 152,
        custom_trim_height: 229,
        custom_bleed: 3,
        custom_spine: 10,
        booklet: true,
        booklet_portrait: false,

        // Content
        content: [
            {
                type: 'title',
                id: generate_token(),
                title: "Titus",
                subtitle: "",
                icon: 'game-icons:tied-scroll',
                icon_size: 1,
                pattern: 'straight',
                color_primary: null,
                color_secondary: null,
                alone: true,
            },
            {
                type: 'passage',
                id: generate_token(),
                book: 'tit',
                start_chapter: null,
                start_verse: null,
                end_chapter: null,
                end_verse: null,
                title: false,
                new_page: true,
            },
            {
                type: 'custom',
                id: generate_token(),
                name: "Copyright",
                doc: {type: 'doc', content: [
                    {type: 'paragraph', content: [{type: 'text', text: 'AUTO-COPYRIGHT'}]},
                ]},
                position: 'bottom',
                new_page: true,
            },
        ],
        bibles: [content.collection.get_preferred_resource().id],
        bibles_layout: 'columns',

        // Features
        show_headings: true,
        show_chapters: true,
        show_chapters_style: 'divider',
        show_verses: true,
        show_pages: true,
        show_footnotes: true,
        show_wj: false,
        show_wj_color: '#cc0000',
        show_wj_bold: false,
        show_wj_italic: false,
        show_lines: true,
        notes: null,
        crossref: null,
        half_blank: null,

        // Style
        font_text: "Crimson Pro",
        font_text2: null,
        font_headings: null,
        font_titles: null,

        // Max pages 30 (15 sheets) but ideally not greater than 20 (10 sheets)
        font_size: 10,  // Pref 10, lowest 8
        line_height: 1.75,  // Pref 1.75, lowest 1.5

        justify: null,
        text_color: null,
        columns: null,

        // Spacing
        margin_unit: 'mm',
        margin_top: 10,
        margin_bottom: 10,
        margin_inner: 10,
        margin_outer: 10,
        column_gap: 5,

        // Legal
        public_domain: true,
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
            valid[key] = cloneDeep(val)
        }
    }

    // Ensure bibles still exist
    valid.bibles = valid.bibles.filter(b => b in content.translations) as [string, ...string[]]
    if (!valid.bibles.length){
        valid.bibles.push(content.collection.get_preferred_resource().id)
    }

    return valid
}


// Generate name for content item
export function gen_content_name(item:ContentItem):string{
    if (item.type === 'passage'){
        return content.collection.reference_to_string(new PassageReference(item), blue.bibles[0])
    } else if (item.type === 'custom' && item.name){
        return item.name
    } else if (item.type === 'title'){
        return item.title
    }
    return "Nameless"
}
