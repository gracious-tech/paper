
// Store of user-uploaded custom fonts (not in the curated typst-fonts manifest). Parsing/
// grouping logic itself lives in typst-fonts' process_font_files (shared with other apps) —
// this module is the thin Vue-reactive wrapper + browser File reading paper.bible needs.
//
// Fonts belong to a design, not to an account: the bytes live under the design's own asset
// prefix and the design doc carries a `fonts` map naming them. So `custom_fonts` below is the
// *open design's* font set, refilled whenever a different design is opened — which is what
// lets an unused font actually be reclaimed (see design_assets.ts). Reuse across designs is
// offered as suggestions that copy the bytes into the design that wants them.

import {reactive} from 'vue'

import {doc, updateDoc, FieldPath, deleteField} from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getBytes} from 'firebase/storage'
import {process_font_files} from 'typst-fonts'
import {register_custom_font_preview} from 'typst-fonts/web'
import {design_assets_prefix, to_version_asset} from 'paper-bible-typst'

import {firestore, firebase_storage} from '@/services/firebase'
import {typst_generator} from '@/services/typst'
import {hash_bytes} from '@/services/cover'
import {request_reconcile} from '@/services/design_assets'
import {generate_token} from '@/services/utils'

import type {StoredFontMeta} from 'paper-bible-typst'
import type {AssetCopy} from '@/services/design_assets'
import type {CustomFont, FontStyle} from 'typst-fonts'
import type {Blueprint} from '@/services/types'

export type {StoredFontMeta}


// Reactive list of the open design's uploaded font families, shared by the font pickers and
// the PDF generator (the generator's worker holds a copy, so every change re-sends the set)
export const custom_fonts:CustomFont[] = reactive([])


// The same set as it's recorded on the design doc, keyed by font id — kept alongside the bytes
// above so a family can be found and dropped by id, and so freezing a version knows the
// Storage paths without re-deriving them
export const design_font_meta = reactive({} as Record<string, StoredFontMeta>)


export function clear_design_fonts():void {
    // Drop the open design's fonts, ready for another design's to load
    custom_fonts.splice(0, custom_fonts.length)
    for (const key of Object.keys(design_font_meta)){
        delete design_font_meta[key]
    }
}


function font_mime(bytes:Uint8Array|undefined):string {
    // The content type to store a font's bytes under. Only TTF and OTF are ever accepted (see
    // DialogFontUpload's `accept`; zips are unpacked first), and both are stored under a
    // type-neutral `.bin` basename, so the magic number is the only thing that tells them
    // apart. Worth getting right because the Storage rules allowlist real font/* types — a
    // catch-all octet-stream would readmit every other file format along with them
    const otto = bytes?.[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f
    return otto ? 'font/otf' : 'font/ttf'
}


async function push_to_worker():Promise<void> {
    // Re-send the font set to the generator's worker (it holds a copy, not our array
    // reference). If the worker isn't ready yet, init.ts sends the set once it is
    if (typst_generator.value){
        await typst_generator.value.set_custom_fonts(custom_fonts)
    }
}


export async function load_design_fonts(meta:Record<string, StoredFontMeta>):Promise<void> {
    // Mirror the open design's `fonts` map into the reactive set, downloading the bytes of any
    // family that has appeared and dropping any that has gone. Diffed rather than rebuilt so a
    // co-editor's unrelated change doesn't re-download everything — and so the bytes of a font
    // this client just uploaded are never thrown away and fetched back
    const wanted = new Set(Object.keys(meta))
    for (const id of Object.keys(design_font_meta)){
        if (!wanted.has(id)){
            const family = design_font_meta[id]!.family
            delete design_font_meta[id]
            const index = custom_fonts.findIndex(font => font.family === family)
            if (index !== -1){
                custom_fonts.splice(index, 1)
            }
        }
    }
    const added:CustomFont[] = []
    for (const [id, entry] of Object.entries(meta)){
        if (id in design_font_meta){
            continue
        }
        design_font_meta[id] = entry
        const font = await load_font_from_meta(entry)
        custom_fonts.push(font)
        added.push(font)
    }
    for (const font of added){
        await register_custom_font_preview(font)
    }
    await push_to_worker()
}


// Read uploaded files (individual .ttf/.otf, or .zip archives), register any new families for
// preview + generation, and return the newly-added family names
export async function upload_custom_fonts(design_id:string, files:File[]):Promise<string[]> {
    const inputs = await Promise.all(files.map(async file => ({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
    })))
    return add_design_fonts(design_id, process_font_files(inputs))
}


// Add already-parsed font families to the open design (used by the upload flow above, and for
// fonts uploaded inside the embedded cover editor, which arrive pre-parsed as CustomFont[]).
// Uploads the bytes, records them on the design doc, and returns the family names added.
//
// NOTE The reactive set is updated here rather than left to the design snapshot to refill.
// DialogCoverEditor adds the widget's fonts and then immediately computes
// cover_font_families(), which intersects the form's families with `custom_fonts` — anything
// missing at that moment is silently dropped from the cover. The doc write is awaited first,
// so load_design_fonts()'s "drop what the doc no longer has" pass can't race these away
export async function add_design_fonts(design_id:string, fonts:CustomFont[]):Promise<string[]> {
    const added:string[] = []
    const updates:unknown[] = []
    const entries:[string, StoredFontMeta][] = []

    for (const font of fonts){
        // A family the design already has is *replaced*, not skipped — re-uploading is how a
        // user fixes a wrong or incomplete file, and silently keeping the old one looks broken.
        // The superseded bytes are reclaimed by the reconcile at the end
        const existing = Object.entries(design_font_meta)
            .find(([, entry]) => entry.family === font.family)
        if (existing){
            updates.push(new FieldPath('fonts', existing[0]), deleteField())
        }

        const font_id = generate_token()
        const files:string[] = []
        for (const bytes of font.files){
            const path = `${design_assets_prefix(design_id)}${await hash_bytes(bytes)}.bin`
            await uploadBytes(storage_ref(firebase_storage, path), bytes,
                {contentType: font_mime(bytes)})
            files.push(path)
        }
        const entry:StoredFontMeta = {family: font.family, style: font.style, files}
        updates.push(new FieldPath('fonts', font_id), entry)
        entries.push([font_id, entry])
        added.push(font.family)
    }

    if (!updates.length){
        return []
    }
    await updateDoc(doc(firestore, 'designs', design_id),
        updates[0] as FieldPath, updates[1], ...updates.slice(2))

    // Now the doc says so, mirror it locally rather than waiting for the snapshot
    for (const [font_id, entry] of entries){
        const stale = Object.entries(design_font_meta)
            .find(([id, item]) => id !== font_id && item.family === entry.family)
        if (stale){
            delete design_font_meta[stale[0]]
        }
        design_font_meta[font_id] = entry
    }
    for (const font of fonts){
        const index = custom_fonts.findIndex(item => item.family === font.family)
        if (index === -1){
            custom_fonts.push(font)
        } else {
            custom_fonts.splice(index, 1, font)
        }
        await register_custom_font_preview(font)
    }
    await push_to_worker()
    request_reconcile(design_id)

    return added
}


// Remove an uploaded font family from the design. Only the doc entry goes — the bytes are
// reclaimed by the server, which re-reads the design so a co-editor who started using the same
// family in the meantime doesn't lose it. Already-created versions are untouched: each froze
// its own snapshot, so their PDFs still regenerate exactly as rendered. The design itself falls
// back to a default font at its next compile if it still names the family
export async function remove_design_font(design_id:string, family:string):Promise<void> {
    const ids = Object.entries(design_font_meta)
        .filter(([, entry]) => entry.family === family)
        .map(([id]) => id)
    if (!ids.length){
        return
    }
    const updates = ids.flatMap(id => [new FieldPath('fonts', id), deleteField()])
    await updateDoc(doc(firestore, 'designs', design_id),
        updates[0] as FieldPath, updates[1], ...updates.slice(2))
    for (const id of ids){
        delete design_font_meta[id]
    }
    const index = custom_fonts.findIndex(font => font.family === family)
    if (index !== -1){
        custom_fonts.splice(index, 1)
    }
    await push_to_worker()
    request_reconcile(design_id)
}


// Download a persisted font's bytes back into a usable CustomFont
export async function load_font_from_meta(meta:StoredFontMeta):Promise<CustomFont> {
    const files = await Promise.all(meta.files.map(async path => {
        return new Uint8Array(await getBytes(storage_ref(firebase_storage, path)))
    }))
    return {family: meta.family, style: meta.style, files}
}


// The uploaded font families a blueprint actually references (book fonts + cover fonts, so
// version snapshots and server compiles carry everything both renders need)
export function fonts_for_blueprint(blueprint:Blueprint):CustomFont[] {
    const wanted = new Set([blueprint.font_text, blueprint.font_text2,
        blueprint.font_headings, blueprint.titlepage_font].filter(f => f !== null))
    for (const family of blueprint.cover?.font_families ?? []){
        wanted.add(family)
    }
    return custom_fonts.filter(font => wanted.has(font.family))
}


// Snapshot the custom fonts a version depends on into the design's append-only version_assets
// prefix, so regeneration never depends on what the live design still references. Returns the
// metadata to freeze on the version doc plus the copy jobs that put the bytes there — which
// are usually no-ops, since a re-render of unchanged content finds them already in place
export function plan_version_fonts(design_id:string, blueprint:Blueprint)
        :{meta:StoredFontMeta[], copies:AssetCopy[]} {
    const meta:StoredFontMeta[] = []
    const copies:AssetCopy[] = []
    for (const font of fonts_for_blueprint(blueprint)){
        const entry = Object.values(design_font_meta).find(item => item.family === font.family)
        if (!entry){
            continue
        }
        const files = entry.files.map(path => to_version_asset(path, design_id))
        for (const [i, path] of files.entries()){
            // The loaded bytes are index-aligned with the stored paths (both written in order
            // by add_design_fonts), so the snapshot is labelled the same way the original was
            copies.push({from: entry.files[i]!, to: path,
                content_type: font_mime(font.files[i])})
        }
        meta.push({family: font.family, style: font.style, files})
    }
    return {meta, copies}
}


// Family -> style lookup for BibleContent.resolve()'s custom_font_styles param, which needs a
// custom font's style to correctly match Noto script fallbacks (it can't detect this itself —
// custom fonts are never in the curated manifest get_bundled_font() reads from)
export function get_custom_font_styles():Record<string, FontStyle> {
    return Object.fromEntries(custom_fonts.map(f => [f.family, f.style]))
}
