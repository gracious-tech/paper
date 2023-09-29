
import client_css from '@gracious.tech/fetch-client/client.css?raw'

import {gen_passage_css, gen_passage_html} from '@/services/render/render_passage'
import {gen_title_css, gen_title_html} from '@/services/render/render_title'
import {gen_custom_css, gen_custom_html} from '@/services/render/render_custom'
import {blue} from '@/services/state'
import {gen_base_css} from '@/services/render/render_base'


export function gen_subjobs():[string, string|null, boolean][]{
    return blue.content.map(item => {
        if (item.type === 'title'){
            return [gen_title_html(item), false, item.alone]
        } else if (item.type === 'custom'){
            return [gen_custom_html(item), false, false]
        } else if (item.type === 'passage'){
            return [
                gen_passage_html(item, 0),
                blue.bibles.length > 1 && blue.bibles_layout === 'alternate'
                    ? gen_passage_html(item, 1)
                    : (blue.half_blank ? null : false),
                false,
            ]
        }
        throw new Error("Invalid type")
    })
}


export function gen_combined_css(){
    return client_css + gen_base_css() + gen_passage_css() + gen_title_css() + gen_custom_css()
}
