
import {get_bundled_font, get_noto_font, base_font} from 'typst-fonts'

import type {TypstRequest} from './types.js'

// Re-export the bundled font type and lookup — callers must init typst-fonts first (via
// typst-fonts/node's load_fonts_dir() or typst-fonts/web's load_fonts_prefix()) before this
// or collect_fonts() below will throw
export type {BundledFont} from 'typst-fonts'
export {get_bundled_font} from 'typst-fonts'


// Collect the unique font families needed to render a request (base font always included
// first). The body font comes from typography; the heading font applies document-wide to any
// heading (chapter markers, section headings) so it's always needed. The title font (already
// resolved from "auto" to font_text by BibleContent.resolve() if not explicitly chosen) is
// only needed when the content that uses it is actually present.
export function collect_fonts(request:TypstRequest):string[] {
    const needed = new Set<string>()

    // Body font and any fallbacks — curated (get_bundled_font) or Noto script/region fallback
    // families (get_noto_font, e.g. "Noto Sans Hebrew") set by BibleContent.resolve()'s script
    // detection; only families actually resolvable to a font source are kept
    needed.add(request.typography.font_text)
    for (const fallback of request.typography.font_fallbacks){
        if (get_bundled_font(fallback) || get_noto_font(fallback)){
            needed.add(fallback)
        }
    }

    // Heading font — applies to any heading, regardless of which features use them
    needed.add(request.typography.font_headings)

    // Title pages use the title font for text (icons are embedded SVG images, not a font)
    if (request.content.some(item => item.type === 'title')){
        needed.add(request.typography.font_titles)
    }

    // Base font always first, then the rest (excluding base) sorted for a stable cache key
    const base = base_font()
    needed.delete(base)
    return [base, ...[...needed].sort()]
}
