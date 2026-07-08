
// Processes user-uploaded font files (individual .ttf/.otf, or a .zip archive e.g. downloaded
// from Google Fonts) into families ready for a caller's own custom-font store. Pure and
// environment-agnostic — no fs/DOM — so it's usable from a browser upload flow or a Node CLI
// alike. Resolving where a family's bytes actually end up (blob URLs for a WASM compiler,
// on-disk files for a CLI's --font-path) is a separate, environment-specific concern — see
// typst-fonts/web's register_custom_font_preview and typst-fonts/node's write_custom_fonts.

import {unzipSync} from 'fflate'

import {parse_font_family, parse_font_style} from './sfnt.js'

import type {FontStyle} from './noto.js'


/** A user-uploaded font family, grouped from one or more weight/style files */
export interface CustomFont {
    family:string
    style:FontStyle
    files:Uint8Array[]
}

// Weights excluded as exotic variants a generator doesn't need
const SKIP_WEIGHTS = /-(Thin|ExtraLight|Light|Medium|SemiBold|ExtraBold|Black|Heavy|UltraLight|DemiBold|UltraBold)/i

// Variable font filename patterns excluded (single static weights are preferred)
const VARIABLE_FONT = /VariableFont|\[/

// Whether a filename is a font file worth keeping, applying the weight/variable-font filters
function should_include(name:string):boolean {
    const base = name.split('/').pop() || ''
    if (!/\.(ttf|otf)$/i.test(base))
        return false
    if (VARIABLE_FONT.test(base))
        return false
    if (SKIP_WEIGHTS.test(base))
        return false
    return true
}

// Extract raw font file entries from a set of uploaded files, expanding any .zip archives.
// filtered selects whether the weight/variable-font filters above apply
function extract_font_files(
    files:{name:string, data:Uint8Array}[], filtered:boolean,
):{name:string, data:Uint8Array}[] {
    const out:{name:string, data:Uint8Array}[] = []
    for (const {name, data} of files) {
        if (name.toLowerCase().endsWith('.zip')) {
            const entries = unzipSync(data)
            for (const [path, entry_data] of Object.entries(entries)) {
                const base = path.split('/').pop() || ''
                if (filtered ? should_include(path) : /\.(ttf|otf)$/i.test(base)) {
                    out.push({name: base, data: entry_data})
                }
            }
        } else if (filtered ? should_include(name) : /\.(ttf|otf)$/i.test(name)) {
            out.push({name, data})
        }
    }
    return out
}

// Process uploaded font files into families: extracts .zip archives, filters to the weights a
// generator needs, groups files by their parsed family name, and classifies each family's
// serif/sans style. Falls back to an unfiltered pass if the filtered one yields nothing (e.g. a
// zip containing only Light/Bold weights, no Regular) so an upload never silently produces zero
// families just because it lacks the "preferred" weight set.
export function process_font_files(files:{name:string, data:Uint8Array}[]):CustomFont[] {
    let font_files = extract_font_files(files, true)
    if (font_files.length === 0) {
        font_files = extract_font_files(files, false)
    }

    // Group by family name parsed from each file's own font metadata
    const families = new Map<string, Uint8Array[]>()
    for (const {data} of font_files) {
        const family = parse_font_family(data)
        if (!family)
            continue
        const existing = families.get(family)
        if (existing) {
            existing.push(data)
        } else {
            families.set(family, [data])
        }
    }

    // Classify style from the first file that declares it, falling back to the family name,
    // then serif (book body/title fonts skew serif)
    const result:CustomFont[] = []
    for (const [family, family_files] of families) {
        const sniffed = family_files.map(f => parse_font_style(f)).find(s => s !== null)
        const style = sniffed ?? (/sans/i.test(family) ? 'sans' : 'serif')
        result.push({family, style, files: family_files})
    }
    return result
}
