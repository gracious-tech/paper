
// typst-fonts — generic font manifest/fallback logic for Typst-based apps. Core (this entry
// point) must never import Node-only (fs, child_process) or Web-only (fetch, Blob, document)
// APIs — those live behind the typst-fonts/node and typst-fonts/web subpath exports instead.

export {init_fonts} from './manifest.js'
export type {BundledFont, FontsData} from './manifest.js'
export {get_fonts, get_bundled_font, base_font, font_style} from './manifest.js'

export type {CjkVariant, FontStyle, NotoFont, NotoManifest, CjkSegment} from './noto.js'
export {get_noto_font, detect_scripts, detect_cjk_variant, field_cjk_variant,
    cjk_segments, cjk_family, resolve_fallback_chain} from './noto.js'

export {parse_font_family, parse_font_style} from './sfnt.js'
