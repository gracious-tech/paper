
import {blue, page_width, page_height} from '@/services/state'


// Generate a valid html doc with custom css and content
export function gen_html(css:string, body:string):string{
    return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <style>
                ${css}
            </style>
        </head>
        <body>${body}</body>
    `
}


// Generate css that is applicable to all pages
export function gen_base_css(){
    return `

        @page {
            size: ${page_width.value}${blue.paper_unit} ${page_height.value}${blue.paper_unit};
            margin: ${blue.margin_top}${blue.margin_unit} ${blue.margin_right}${blue.margin_unit}
                ${blue.margin_bottom}${blue.margin_unit} ${blue.margin_left}${blue.margin_unit};
            @footnote {
                margin-top: 0.5em;
                padding: 2mm;
                border-top: 0.2mm solid #0003;
            }
            /*
            @bottom-center {
                content: '{{page_number}}';
                margin-bottom: ${blue.margin_bottom}${blue.margin_unit};
                margin-top: 1em;
                font-size: 10pt;
            }
            */
        }

        body {
            margin: 0; /* Weasy does have default 8px which can mess up first line alignment */
            font-family: "${blue.font_family}", "Georgia", "Times New Roman", serif;
            font-size: ${blue.font_size}pt;
            line-height: ${blue.line_height};
            text-align: ${blue.justify === false ? 'start' : 'justify'};
        }

        p {
            /* Rely on line-height for spacing, not margins */
            margin-top: 0;
            margin-bottom: 0;
        }

        p + p {
            text-indent: 1.5em;
        }
    `
}
