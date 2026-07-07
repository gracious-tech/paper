
// Downloads the mandatory Noto set for an app's fonts_dir: the Noto Serif/Sans base (first-
// class, selectable fonts, not just fallbacks — downloaded live via the same Google Fonts API
// as curated fonts) plus the full per-script Noto fallback system and CJK regional subsets
// (downloaded from the package's bundled, static generated/noto_sources.json — no live
// state.json fetch needed here, since that manifest/URL structure never varies per app).

import {writeFile, mkdir, access} from 'node:fs/promises'
import {dirname, join, basename} from 'node:path'
import type {BundledFont} from '../manifest.js'
import {download_font, pick_preview} from './google_fonts.js'
import noto_manifest from '../generated/noto_manifest.json' with {type: 'json'}
import noto_sources from '../generated/noto_sources.json' with {type: 'json'}

const NOTO_BASE_FAMILIES = ['Noto Serif', 'Noto Sans'] as const

// Download a single file by URL into dest_path; skips if it already exists
async function download_file(url:string, dest_path:string):Promise<void> {
    try {
        await access(dest_path)
        return
    } catch {
        // Fall through to download
    }
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`)
    }
    await mkdir(dirname(dest_path), {recursive: true})
    await writeFile(dest_path, new Uint8Array(await resp.arrayBuffer()))
}

// Downloads Noto Serif/Sans (4 weights each) + every bundled fallback/CJK family's files.
// Returns the base BundledFont entries (Noto Serif first) for the app's own manifest.json.
export async function download_noto(fonts_dir:string, noto_group:string):Promise<BundledFont[]> {
    const base:BundledFont[] = []
    for (const family of NOTO_BASE_FAMILIES) {
        process.stdout.write(`  ${family}...`)
        const files = await download_font(fonts_dir, family)
        base.push({
            family,
            group: noto_group,
            style: family === 'Noto Serif' ? 'serif' : 'sans',
            files,
            preview_file: pick_preview(files),
        })
        console.log(` ${files.length} files`)
    }

    const sources = noto_sources as Record<string, string[]>
    const all_families = [...noto_manifest.sans, ...noto_manifest.serif]
        .map(f => f.family)
        .filter((family, i, arr) => arr.indexOf(family) === i)

    console.log(`\nDownloading fonts for ${all_families.length} Noto fallback families...\n`)
    for (const family of all_families) {
        const urls = sources[family]
        if (!urls) continue
        process.stdout.write(`  ${family}...`)
        const dir = join(fonts_dir, '_noto', family)
        for (const url of urls) {
            await download_file(url, join(dir, basename(url)))
        }
        console.log(' done')
    }

    return base
}
