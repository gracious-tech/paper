
import patterns from '@/services/patterns'
import {escape_html} from '@/services/utils'
import {blue, page_height, page_width} from '@/services/state'

import type {ContentTitle} from '@/services/types'


// Render a title page content item to html
export function gen_title_html(content:ContentTitle):string{

    // Get pattern SVG and replace colors with custom
    let pattern_svg = (patterns as Record<string, string>)[content.pattern] ?? ''
    pattern_svg = pattern_svg.replace(/\#00000033/g, content.color_secondary)

    // Body of title page
    return `
        <div class='title'>
            ${pattern_svg.replace('<svg ', '<svg class="pattern-tl" ')}
            ${pattern_svg.replace('<svg ', '<svg class="pattern-tr" ')}
            ${pattern_svg.replace('<svg ', '<svg class="pattern-bl" ')}
            ${pattern_svg.replace('<svg ', '<svg class="pattern-br" ')}
            <div style='color: ${content.color_primary}'>
                <h1>${escape_html(content.title)}</h1>
                <h1 class='title_subtitle'>${escape_html(content.subtitle)}</h1>
            </div>
            <div class='title_icon' style='color: ${content.color_secondary}'>
                ${escape_html(content.icon)}
            </div>
        </div>
    `
}


// Generate CSS sepecific to title pages
export function gen_title_css(){
    return `
        .title {
            text-align: center;
            font-family: "Dancing Script";
            font-weight: 700;
            line-height: 1;
        }

        .title svg {
            position: absolute;
            width: ${page_width.value / 3}${blue.paper_unit};
        }

        .pattern-tl {
            top: 0;
            left: 0;
        }

        .pattern-tr {
            top: 0;
            right: 0;
            transform: scale(-1, 1);
        }

        .pattern-bl {
            bottom: 0;
            left: 0;
            transform: scale(1, -1);
        }

        .pattern-br {
            bottom: 0;
            right: 0;
            transform: scale(-1, -1);
        }

        .title h1 {
            margin: 0;
            padding-top: ${page_height.value / 6}${blue.paper_unit};
            padding-bottom: 0.5cm;
            font-size: 55pt;
        }

        .title h1 + h1 {
            padding-top: 0;
            padding-bottom: ${page_height.value / 5}${blue.paper_unit};
            font-size: 20pt;
        }

        .title_icon {
            font-family: "Noto Emoji";
            font-weight: 300;
            font-size: ${page_height.value / 4}${blue.paper_unit};
        }
    `
}
