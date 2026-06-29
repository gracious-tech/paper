
import {FONT_MANIFEST} from './generated/font_manifest.js'

import type {BundledFont} from './generated/font_manifest.js'
import type {TypstRequest} from './types.js'


// Re-export the bundled font type for consumers
export type {BundledFont} from './generated/font_manifest.js'


// Asset subdirectory name for fonts (under a consumer-provided assets prefix)
export const FONTS_DIR = 'fonts'


// All bundled fonts — the base font is always first
export const BUNDLED_FONTS:BundledFont[] = FONT_MANIFEST


// The base font family (always first in the manifest) — used for footers and dividers,
// so it must always be loaded regardless of the chosen body font
export const BASE_FONT = BUNDLED_FONTS[0]!.family


// Index by family name for fast lookup
const by_family = new Map(BUNDLED_FONTS.map(font => [font.family, font]))


// Look up a bundled font by its family name
export function get_bundled_font(family:string):BundledFont | undefined {
    return by_family.get(family)
}


// Join path segments with '/' — works for both filesystem paths and URLs
export function asset_path(base:string, ...segments:string[]):string {
    return [base.replace(/\/+$/, ''), ...segments].join('/')
}


// Collect the unique font families needed to render a request (base font always included
// first). The body font comes from typography; title pages additionally need the display
// font and the emoji font.
export function collect_fonts(request:TypstRequest):string[] {
    const needed = new Set<string>()

    // Body font and any fallbacks (only those that are actually bundled)
    needed.add(request.typography.font_family)
    for (const fallback of request.typography.font_fallbacks){
        if (by_family.has(fallback)){
            needed.add(fallback)
        }
    }

    // Title pages use the display font for text and the emoji font for icons
    if (request.content.some(item => item.type === 'title')){
        needed.add('Dancing Script')
        needed.add('Noto Emoji')
    }

    // Base font always first, then the rest (excluding base) sorted for a stable cache key
    needed.delete(BASE_FONT)
    return [BASE_FONT, ...[...needed].sort()]
}
