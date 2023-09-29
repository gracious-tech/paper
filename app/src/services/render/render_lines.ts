

const line_spacing_mm = 10


// Render a page with faint lines for writing notes
export function gen_lines_html():string{
    const a3_height_mm = 420
    const line = '<div></div>'
    return '<div class="lines">' + line.repeat(Math.ceil(a3_height_mm / line_spacing_mm)) + '</div>'
}


// Generate CSS sepecific to lines page
export function gen_lines_css(){
    return `
        .lines div {
            height: ${line_spacing_mm}mm;
            border-bottom: 1px dotted #0003;
        }
    `
}
