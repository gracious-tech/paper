
// Orchestrates a per-app font download: the mandatory Noto set (always) plus an optional
// caller-supplied curated font list, writing the resulting manifest.json into fonts_dir. Noto's
// own manifest/fallback data (noto_manifest.json, han_hints.json) ships bundled with the
// package instead — nothing else is written here.

import {writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import type {DownloadOptions} from './types.js'
import {download_noto} from './noto.js'
import {download_curated} from './curated.js'

export async function run_download(opts:DownloadOptions):Promise<void> {
    const noto_base = await download_noto(opts.fonts_dir, opts.config?.noto_group ?? 'Noto')
    const curated = opts.config?.curated
        ? await download_curated(opts.fonts_dir, opts.config.curated)
        : []
    const font_manifest = [...noto_base, ...curated]  // Noto Serif always index 0

    await mkdir(opts.fonts_dir, {recursive: true})
    await writeFile(join(opts.fonts_dir, 'manifest.json'), JSON.stringify(font_manifest, null, 4) + '\n')
    console.log(`\nGenerated ${join(opts.fonts_dir, 'manifest.json')}`)
}
