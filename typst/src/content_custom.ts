
import type {TypstCustomPage} from './types.js'


// Heading styling for rich-text custom content, rather than leaving Typst's defaults:
//  * spacing — the document-wide `par.spacing` is pinned to leading (see gen_preamble), which a
//    heading's block would otherwise inherit, leaving it flush against the text above and below
//  * regular weight — a bold-by-default heading makes the editor's bold button a no-op on heading
//    text (nothing to un-bold), so weight is left for the user to add; size is what marks a
//    heading out (an explicit bold mark within the text still renders bold, as the user asked)
//  * size — the two levels the editor offers are pinned to multiples of the body size, so a Typst
//    release that re-tunes its own per-level defaults can't resize custom pages behind us (any
//    other level, only reachable by pasting, stays at body size via the blanket rule). They have
//    to be expressed against `font_size` rather than in `em`: within a heading show rule an em
//    resolves against the heading's already-scaled size, so `1.4em` would compound on top of the
//    very default it means to replace (Typst's level-1 default of 14pt would land at 19.6pt)
// Applied inside a scope in both paths below, so they can't leak into the rest of the document.
// Blanket rules come first (they cover every level), then the per-level sizes that override them
function gen_heading_rules(font_size:string):string {
    return `#show heading: set block(above: 1.5em, below: 1.1em)
#show heading: set text(weight: "regular", size: ${font_size})
#show heading.where(level: 1): set text(size: 1.4 * ${font_size})
#show heading.where(level: 2): set text(size: 1.2 * ${font_size})`
}


// Generate Typst markup for a custom content page
export function gen_custom(custom:TypstCustomPage, font_size:string):string {

    const heading_rules = gen_heading_rules(font_size)

    // Content at top just renders in normal flow (grouped so the heading rules stay scoped)
    if (custom.position !== 'middle' && custom.position !== 'bottom') {
        return `#[\n${heading_rules}\n${custom.content}\n]`
    }

    // Middle/bottom: measure the content against the page. If it fits, pin it to the page with a
    // full-height block so it centres/sits at the bottom. If it's taller than the page, render it
    // in normal flow instead so it breaks across pages (top-aligned) rather than overflowing a
    // fixed-height block and getting clipped at the bottom. The block must be full-width (auto
    // shrinks to content), otherwise horizontal alignment within the body has no room to act.
    const alignment = custom.position === 'middle' ? 'horizon' : 'bottom'
    return `#layout(size => context {
    let body = [
${heading_rules}
${custom.content}
    ]
    let content_height = measure(box(width: size.width, body)).height
    if content_height <= size.height {
        block(width: 100%, height: size.height, align(${alignment}, body))
    } else {
        body
    }
})`
}
