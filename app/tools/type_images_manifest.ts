// The manifest of the wizard's rendered type pictures (see gen_type_images.ts), and the check
// that tells when a UI locale has none yet. Kept apart from the generator so .bin/i18n_check can
// run the check without loading the renderer

import {existsSync, readFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'


// This file lives in <repo>/app/tools/
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export const IMAGES_DIR = join(APP_DIR, 'src', 'assets', 'images', 'design_types')
export const MANIFEST_PATH = join(IMAGES_DIR, 'manifest.json')


// Keyed by UI locale: the translation its pictures were rendered in, or null when fetch.bible
// has no Bible in that language (the app then shows the English screenshots)
export type TypeImagesManifest = Record<string, {bible:string|null}>


// Read the manifest (empty before anything was ever rendered)
export function read_type_images_manifest():TypeImagesManifest{
    return existsSync(MANIFEST_PATH)
        ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as TypeImagesManifest
        : {}
}


// Every UI locale (other than English, whose pictures are the screenshots) never rendered
export function type_image_problems():string[]{
    const manifest = read_type_images_manifest()
    const meta = JSON.parse(readFileSync(join(APP_DIR, 'src', 'locales.json'), 'utf8')) as
        {locales:Record<string, unknown>}
    const missing = Object.keys(meta.locales).filter(loc => loc !== 'en' && !(loc in manifest))
    return missing.length
        ? [`no wizard type pictures for: ${missing.join(', ')} (run .bin/gen_type_images)`]
        : []
}
