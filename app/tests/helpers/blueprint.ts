
// A known-good Blueprint for the app suites to mutate.
//
// Built from the app's own get_default_blueprint() so it can never drift from what the app
// actually creates — that function asks the (stubbed) content service for a preferred
// translation, which is why it can be called here at all.

import {get_default_blueprint} from '@/services/blueprints'

import type {Blueprint, ContentItem, ContentPassage} from '@/services/types'


export function make_blueprint(overrides:Partial<Blueprint> = {}):Blueprint {
    return {...get_default_blueprint(), ...overrides}
}


export function make_passage(id:string, overrides:Partial<ContentPassage> = {}):ContentPassage {
    // A passage item; with no chapter/verse fields set it means the whole book, which is the
    // convention the wizard's book picker uses
    return {
        type: 'passage',
        id,
        book: 'gen',
        start_chapter: null,
        start_verse: null,
        end_chapter: null,
        end_verse: null,
        title: null,
        title_subtitle: '',
        title_icon: null,
        image: null,
        ...overrides,
    }
}


export function make_title(id:string, title = 'A title'):ContentItem {
    // A decorative title page
    return {type: 'title', id, title, title_subtitle: '', title_icon: null}
}


export function make_custom(id:string, text = ''):ContentItem {
    // A custom rich-text page, optionally carrying one paragraph of text
    return {
        type: 'custom',
        id,
        name: '',
        doc: text
            ? {type: 'doc', content: [{type: 'paragraph',
                content: [{type: 'text', text}]}]}
            : {type: 'doc', content: []},
        position: 'bottom',
    }
}
