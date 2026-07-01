
import type {TypstCustomPage} from './types.js'


// Generate Typst markup for a custom content page
export function gen_custom(custom:TypstCustomPage):string {

    // Content at top just renders in normal flow
    if (custom.position !== 'middle' && custom.position !== 'bottom') {
        return custom.content
    }

    // Middle/bottom: measure the content against the page. If it fits, pin it to the page with a
    // full-height block so it centres/sits at the bottom. If it's taller than the page, render it
    // in normal flow instead so it breaks across pages (top-aligned) rather than overflowing a
    // fixed-height block and getting clipped at the bottom.
    const alignment = custom.position === 'middle' ? 'horizon' : 'bottom'
    return `#layout(size => context {
    let body = [
${custom.content}
    ]
    let content_height = measure(box(width: size.width, body)).height
    if content_height <= size.height {
        block(height: size.height, align(${alignment}, body))
    } else {
        body
    }
})`
}
