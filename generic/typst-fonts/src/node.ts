
// Node-only helpers: load a curated font manifest from disk, and resolve on-disk font
// directories for spawning a typst binary with --font-path.

import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {init_fonts, get_bundled_font, get_noto_font} from './index.js'

// Reads manifest.json from fonts_dir (as written by this package's own download CLI, or
// hand-placed there some other way) and calls init_fonts. Only the curated manifest is
// runtime-loaded — Noto's own manifest/fallback data is bundled with the package.
export async function load_fonts_dir(fonts_dir:string):Promise<void> {
    const font_manifest = JSON.parse(await readFile(join(fonts_dir, 'manifest.json'), 'utf8'))
    init_fonts({font_manifest})
}

// One directory per resolvable family: curated fonts at <fonts_dir>/<family>/, Noto fallback
// families at <fonts_dir>/_noto/<family>/. Requires load_fonts_dir() to have run first.
export function resolve_font_dirs(fonts_dir:string, families:string[]):string[] {
    const dirs:string[] = []
    for (const family of families) {
        if (get_bundled_font(family))
            dirs.push(join(fonts_dir, family))
        else if (get_noto_font(family))
            dirs.push(join(fonts_dir, '_noto', family))
    }
    return dirs
}
