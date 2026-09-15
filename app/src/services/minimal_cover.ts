
// The wizard's "minimal ink" cover style (home printing only). Unlike the other styles it isn't
// a bookcover cover at all: the design simply opens with an ordinary title page and closes with
// an auto-copyright text page, so the front of a folded booklet is printed by the same
// title-page system as the rest of the interior — no full-bleed art, no second compiler.

import {COPYRIGHT_MARKER} from 'paper-bible-typst'

import {bible_content} from '@/services/content'
import {default_title, get_passages} from '@/services/blueprints'
import {get_custom_font_styles} from '@/services/custom_fonts'
import {book_icon} from '@/services/icons'
import {typst_generator} from '@/services/typst'
import {generate_token} from '@/services/utils'

import type {Blueprint, ContentCustom, ContentTitle} from '@/services/types'


// The title page that stands in for a cover: the design's title (or its first passage's
// reference) plus that book's icon — the same text and icon the bookcover presets would have
// printed on their front panel
export function minimal_cover_title_item(blueprint:Blueprint):ContentTitle{
    const passage = get_passages(blueprint)[0]
    return {
        type: 'title',
        id: generate_token(),
        title: default_title(blueprint),
        title_subtitle: '',
        title_icon: (passage && book_icon[passage.book]) || 'game-icons:open-book',
    }
}


// The closing page carrying the attribution statement, which a cover would otherwise have
// printed on its back panel (AUTO-COPYRIGHT is resolved to the full statement at render time —
// see gen_custom_item in the typst package). Mirrors the editor's own "Copyright" page
export function minimal_cover_copyright_item():ContentCustom{
    return {
        type: 'custom',
        id: generate_token(),
        name: "Copyright",
        doc: {type: 'doc', content: [
            {type: 'paragraph', content: [{type: 'text', text: COPYRIGHT_MARKER}]},
        ]},
        position: 'middle',
    }
}


// Wrap a design's content in the pair of pages that stand in for a cover. The copyright page is
// pinned to the document's last page so it prints on the back of the folded booklet, opposite
// the title page on the front — the two outer faces of the folded sheet
export function apply_minimal_cover(blueprint:Blueprint):void{
    blueprint.content = [
        minimal_cover_title_item(blueprint),
        ...blueprint.content,
        minimal_cover_copyright_item(),
    ]
    blueprint.last_item_at_end = true
}


// Render just the opening title page to an SVG string, for the wizard's cover-selection card —
// the minimal-ink equivalent of render_wizard_cover_preview(), showing the same first page the
// interior compile will produce (single page, so no booklet imposition/padding is involved)
export async function render_minimal_cover_preview(blueprint:Blueprint):Promise<string>{
    const generator = typst_generator.value
    if (!generator){
        throw new Error('Typst compiler not ready')
    }
    // Resolving a title-only document fetches no Bible content — only the icon (via Iconify)
    const request = await bible_content.resolve(
        {...blueprint, content: [minimal_cover_title_item(blueprint)]}, get_custom_font_styles())
    return generator.compile_svg(request)
}
