
// The manifest of the example designs' rendered cover pictures (see gen_example_images.ts), and
// the check that tells when the titles printed on them no longer match the translations. Kept
// apart from the generator so .bin/i18n_check can run the check without a browser

import {existsSync, readFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'


// This file lives in <repo>/app/tools/
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export const IMAGES_DIR = join(APP_DIR, 'src', 'assets', 'images', 'examples')
export const MANIFEST_PATH = join(IMAGES_DIR, 'manifest.json')


// One example's picture in one locale: the hash of everything it was rendered from, the title
// and subtitle it shows, and whether the locale has a file of its own (false when it would be
// identical to English's, which the app then shows instead)
export interface ExampleManifestEntry {
    hash:string
    title:string
    subtitle:string
    file:boolean
}

// Keyed by UI locale, then example id
export type ExampleManifest = Record<string, Record<string, ExampleManifestEntry>>


// Read the manifest (empty before anything was ever rendered)
export function read_manifest():ExampleManifest{
    return existsSync(MANIFEST_PATH)
        ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ExampleManifest
        : {}
}


// Every locale whose pictures are missing, or show a title or subtitle that its catalog has
// since changed (the English text, or its translation). Only the catalog's own wording can be
// checked without a browser: a change to an example's design itself is caught by the generator
// when it's next run, which compares full hashes
export function example_image_problems():string[]{
    const manifest = read_manifest()
    const ids = Object.keys(manifest['en'] ?? {})
    if (!ids.length){
        return ['no example pictures rendered (run .bin/gen_example_images)']
    }
    const read_catalog = (loc:string) => JSON.parse(
        readFileSync(join(APP_DIR, 'src', 'locales', `${loc}.json`), 'utf8')) as
        Record<string, string>
    const en = read_catalog('en')
    const meta = JSON.parse(readFileSync(join(APP_DIR, 'src', 'locales.json'), 'utf8')) as
        {locales:Record<string, unknown>}

    const problems:string[] = []
    for (const loc of Object.keys(meta.locales)){
        const catalog = loc === 'en' ? en : read_catalog(loc)
        const stale = ids.filter(id => {
            const entry = manifest[loc]?.[id]
            if (!entry){
                return true
            }
            // Only fields that come from the catalog (the bilingual example's subtitle doesn't)
            return (['title', 'subtitle'] as const).some(field => {
                const key = `svc.examples.${id}_${field}`
                return key in en && (catalog[key] ?? en[key]) !== entry[field]
            })
        })
        if (stale.length){
            problems.push(`${loc}: example pictures out of date: ${stale.join(', ')}`
                + ' (run .bin/gen_example_images)')
        }
    }
    return problems
}
