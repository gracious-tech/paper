
// Downloads an app's caller-supplied curated font list (beyond the mandatory Noto set)

import type {BundledFont} from '../manifest.js'
import type {CuratedFontSpec} from './types.js'
import {download_font, pick_preview} from './google_fonts.js'

export async function download_curated(fonts_dir:string, specs:CuratedFontSpec[]):Promise<BundledFont[]> {
    const entries:BundledFont[] = []
    for (const spec of specs) {
        process.stdout.write(`  ${spec.family}...`)
        try {
            const files = await download_font(fonts_dir, spec.family)
            entries.push({
                family: spec.family,
                group: spec.group,
                style: spec.style,
                files,
                preview_file: pick_preview(files),
            })
            console.log(` ${files.length} files`)
        } catch (err) {
            console.log(` FAILED: ${(err as Error).message}`)
        }
    }
    return entries
}
