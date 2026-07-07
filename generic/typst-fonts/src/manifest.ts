
// Lookups for an app's curated font manifest. Unlike noto.ts, this data is app-specific — it
// records exactly which fonts got downloaded into a particular app's own fonts directory — so
// it isn't bundled with the package. Call init_fonts() (or a platform loader from
// typst-fonts/node or typst-fonts/web) before using any function here.

import type {FontStyle} from './noto.js'

/** A font in an app's curated manifest */
export interface BundledFont {
    // Font family name exactly as typst expects (e.g. 'Playfair Display')
    family:string
    // Category group shown as a subheading in a font chooser UI
    group:string
    // Serif/sans classification — decides which style of Noto fallback pairs with this font
    style:FontStyle
    // Font filenames in the family's directory (e.g. ['PlayfairDisplay-Regular.ttf', ...])
    files:string[]
    // Filename of the 400-weight file for preview rendering
    preview_file:string
}

export interface FontsData {
    font_manifest:BundledFont[]
}

let font_manifest:BundledFont[] | undefined
let by_family:Map<string, BundledFont> | undefined

// Supply the curated font manifest before using get_fonts/get_bundled_font/base_font/font_style
export function init_fonts(data:FontsData):void {
    font_manifest = data.font_manifest
    by_family = new Map(data.font_manifest.map(f => [f.family, f]))
}

function require_manifest():BundledFont[] {
    if (!font_manifest) {
        throw new Error('typst-fonts: init_fonts() must be called before use')
    }
    return font_manifest
}

// Return a deep copy of the curated fonts list so callers cannot mutate the loaded manifest
export function get_fonts():BundledFont[] {
    return require_manifest().map(f => ({...f, files: [...f.files]}))
}

// Look up a curated font by its family name
export function get_bundled_font(family:string):BundledFont | undefined {
    require_manifest()
    return by_family!.get(family)
}

// The base font family (always first in the manifest — Noto Serif, guaranteed by the
// download step regardless of an app's curated config)
export function base_font():string {
    return require_manifest()[0]!.family
}

// Resolve the serif/sans style of a chosen font: an explicit style (set for custom fonts,
// which aren't in the curated manifest) wins, then the manifest's classification, defaulting
// to serif (the mandatory base font is Noto Serif)
export function font_style(family:string, explicit?:FontStyle):FontStyle {
    return explicit ?? get_bundled_font(family)?.style ?? 'serif'
}
