
// Shared Google Fonts download-list fetch/weight-resolution logic, used for both the
// mandatory Noto Serif/Sans base and arbitrary caller-supplied curated fonts.

import {writeFile, mkdir, access, readdir} from 'node:fs/promises'
import {join, basename} from 'node:path'

const API = 'https://fonts.google.com/download/list'
const WEIGHTS = ['Regular', 'Bold', 'Italic', 'BoldItalic']

// Download a family's static TTF files into <fonts_dir>/<family>/ and return the filenames
export async function download_font(fonts_dir:string, family:string):Promise<string[]> {
    const dir = join(fonts_dir, family)
    const base = family.replace(/\s+/g, '')

    // Skip if Regular already exists — assume the family was fully downloaded
    const regular_path = join(dir, `${base}-Regular.ttf`)
    try {
        await access(regular_path)
        return (await readdir(dir)).filter(f => f.endsWith('.ttf'))
    } catch {
        // File doesn't exist, proceed with download
    }

    await mkdir(dir, {recursive: true})

    // Fetch API response and strip )]}' security prefix
    const url = `${API}?family=${encodeURIComponent(family)}`
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`API returned ${resp.status} for "${family}"`)
    }
    const raw = await resp.text()
    const json = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''))
    const refs:{filename:string, url:string}[] = json.manifest.fileRefs

    const files:string[] = []

    // Try static files for the 4 core weights
    for (const suffix of WEIGHTS) {
        const target = `${base}-${suffix}.ttf`
        let ref = refs.find(r => basename(r.filename) === target)

        // Some fonts (e.g. Merriweather) use optical-size filenames like Base_24pt-Regular.ttf.
        // Fall back to the smallest optical-size variant (the one designed for body-text
        // sizes), excluding condensed/semicondensed.
        if (!ref) {
            const pattern = new RegExp(`^${base}_\\d+pt-${suffix}\\.ttf$`)
            const candidates = refs
                .filter(r => pattern.test(basename(r.filename)))
                .sort((a, b) => basename(a.filename)
                    .localeCompare(basename(b.filename), undefined, {numeric: true}))
            if (candidates.length > 0) {
                ref = candidates[0]
            }
        }

        if (ref) {
            // Always save with the canonical name so downstream code doesn't need to know
            // about optical sizes
            const dest = join(dir, `${base}-${suffix}.ttf`)
            try {
                await access(dest)
            } catch {
                const data = await fetch(ref.url)
                await writeFile(dest, new Uint8Array(await data.arrayBuffer()))
            }
            files.push(`${base}-${suffix}.ttf`)
        }
    }

    if (files.length === 0) {
        throw new Error(`No static font files found for "${family}"`)
    }

    return files
}

// Pick the preview file: prefer *-Regular.ttf, else first file
export function pick_preview(files:string[]):string {
    return files.find(f => f.includes('-Regular.')) ?? files[0]!
}
