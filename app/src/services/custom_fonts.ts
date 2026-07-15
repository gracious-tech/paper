
// Store of user-uploaded custom fonts (not in the curated typst-fonts manifest). Parsing/
// grouping logic itself lives in typst-fonts' process_font_files (shared with other apps) —
// this module is just the thin Vue-reactive wrapper + browser File reading paper.bible needs

import {reactive} from 'vue'

import {collection, doc, getDocs, setDoc} from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {process_font_files} from 'typst-fonts'
import {register_custom_font_preview} from 'typst-fonts/web'

import {firestore, firebase_storage} from '@/services/firebase'
import {user} from '@/services/auth'
import {typst_generator} from '@/services/typst'
import {generate_token} from '@/services/utils'
import {report_error} from '@/services/errors'

import type {CustomFont, FontStyle} from 'typst-fonts'
import type {Blueprint} from '@/services/types'


// Storage-path metadata for a persisted custom font (library docs + version snapshots)
export interface StoredFontMeta {
    family:string
    style:FontStyle
    files:string[]  // Storage object paths
}


// Reactive list of uploaded font families, shared by the font pickers and the PDF generator
// (the generator's worker holds a copy, so every upload re-sends the set — see below)
export const custom_fonts:CustomFont[] = reactive([])


// Read uploaded files (individual .ttf/.otf, or .zip archives), register any new families for
// preview + generation, and return the newly-added family names (skips names already uploaded)
export async function upload_custom_fonts(files:File[]):Promise<string[]> {
    const inputs = await Promise.all(files.map(async file => ({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
    })))
    const parsed = process_font_files(inputs)

    const existing = new Set(custom_fonts.map(f => f.family))
    const added:string[] = []
    for (const font of parsed) {
        if (existing.has(font.family))
            continue
        custom_fonts.push(font)
        existing.add(font.family)
        added.push(font.family)
        await register_custom_font_preview(font)
    }

    // Push the updated font set to the generator's worker (it holds a copy, not our array
    // reference). If the worker isn't ready yet, init.ts sends the set once it is.
    if (added.length && typst_generator.value){
        await typst_generator.value.set_custom_fonts(custom_fonts)
    }

    // Persist new families to the user's online library (best effort — uploads still usable
    // this session even if persistence fails)
    for (const font of parsed){
        if (added.includes(font.family)){
            void persist_font(font).catch((error:unknown) => {
                report_error('banner', error)
            })
        }
    }

    return added
}


// Save one font family to the user's library (bytes in Storage + metadata doc)
async function persist_font(font:CustomFont):Promise<void> {
    const uid = user.value!.uid
    const font_id = generate_token()
    const paths:string[] = []
    for (const [i, bytes] of font.files.entries()){
        const path = `user_fonts/${uid}/${font_id}/${i}.bin`
        await uploadBytes(storage_ref(firebase_storage, path), bytes)
        paths.push(path)
    }
    await setDoc(doc(firestore, 'users', uid, 'fonts', font_id),
        {family: font.family, style: font.style, files: paths})
}


// Load the user's font library from online storage into the reactive set (called at boot and
// after switching accounts)
export async function restore_custom_fonts():Promise<void> {
    const uid = user.value!.uid
    const snap = await getDocs(collection(firestore, 'users', uid, 'fonts'))
    const restored = await Promise.all(snap.docs.map(
        item => load_font_from_meta(item.data() as StoredFontMeta)))

    custom_fonts.splice(0, custom_fonts.length, ...restored)
    for (const font of restored){
        await register_custom_font_preview(font)
    }
    if (typst_generator.value){
        await typst_generator.value.set_custom_fonts(custom_fonts)
    }
}


// Download a persisted font's bytes back into a usable CustomFont
export async function load_font_from_meta(meta:StoredFontMeta):Promise<CustomFont> {
    const files = await Promise.all(meta.files.map(async path => {
        return new Uint8Array(await getBytes(storage_ref(firebase_storage, path)))
    }))
    return {family: meta.family, style: meta.style, files}
}


// The uploaded font families a blueprint actually references
export function fonts_for_blueprint(blueprint:Blueprint):CustomFont[] {
    const wanted = new Set([blueprint.font_text, blueprint.font_text2,
        blueprint.font_headings, blueprint.font_titles].filter(f => f !== null))
    return custom_fonts.filter(font => wanted.has(font.family))
}


// Snapshot the custom fonts a version depends on into its own immutable Storage paths, so
// regeneration (by the owner or a copy recipient) never depends on the user's mutable library.
// Returns the metadata to freeze on the version doc; upload_version_fonts() sends the bytes
// (only allowed after the version doc exists, per Storage rules).
export function plan_version_fonts(version_id:string, blueprint:Blueprint)
        :{meta:StoredFontMeta[], uploads:[string, Uint8Array][]} {
    const meta:StoredFontMeta[] = []
    const uploads:[string, Uint8Array][] = []
    for (const [f, font] of fonts_for_blueprint(blueprint).entries()){
        const paths:string[] = []
        for (const [i, bytes] of font.files.entries()){
            const path = `versions/${version_id}/fonts/${f}_${i}.bin`
            paths.push(path)
            uploads.push([path, bytes])
        }
        meta.push({family: font.family, style: font.style, files: paths})
    }
    return {meta, uploads}
}

export async function upload_version_fonts(uploads:[string, Uint8Array][]):Promise<void> {
    for (const [path, bytes] of uploads){
        await uploadBytes(storage_ref(firebase_storage, path), bytes)
    }
}


// Family -> style lookup for BibleContent.resolve()'s custom_font_styles param, which needs a
// custom font's style to correctly match Noto script fallbacks (it can't detect this itself —
// custom fonts are never in the curated manifest get_bundled_font() reads from)
export function get_custom_font_styles():Record<string, FontStyle> {
    return Object.fromEntries(custom_fonts.map(f => [f.family, f.style]))
}
