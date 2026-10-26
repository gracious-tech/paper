
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


// The stored files each family in `custom_fonts` holds the bytes of (family -> files_key()), so
// a snapshot naming the same files again is recognised without downloading anything. A family
// is only ever held once, however many entries the doc has for it
const loaded_files = new Map<string, string>()

// Ditto for downloads still in flight, so the snapshots that keep arriving meanwhile (any edit
// to the design makes one) don't start the same download again
const loading_files = new Map<string, string>()


export function clear_design_fonts():void {
    // Drop the open design's fonts, ready for another design's to load
    custom_fonts.splice(0, custom_fonts.length)
    loaded_files.clear()
    loading_files.clear()
    for (const key of Object.keys(design_font_meta)){
        delete design_font_meta[key]
    }
}


function files_key(files:string[]):string {
    // One string identifying a family's stored files (their paths are content-addressed)
    return files.join('\n')
}


function hold_font(font:CustomFont, files:string[]):void {
    // Put a family's bytes in the reactive set, replacing any it already held for that family
    const index = custom_fonts.findIndex(item => item.family === font.family)
    if (index === -1){
        custom_fonts.push(font)
    } else {
        custom_fonts.splice(index, 1, font)
    }
    loaded_files.set(font.family, files_key(files))
}


function release_font(family:string):void {
    // Drop a family's bytes from the reactive set
    const index = custom_fonts.findIndex(font => font.family === family)
    if (index !== -1){
        custom_fonts.splice(index, 1)
    }
    loaded_files.delete(family)
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
    // family whose files changed and dropping any family that has gone. Diffed by family and
    // files rather than rebuilt so a co-editor's unrelated change doesn't re-download
    // everything, and so the bytes of a font this client just uploaded are never thrown away
    // and fetched back (add_design_fonts records them before its write can echo back here)
    for (const id of Object.keys(design_font_meta)){
        if (!(id in meta)){
            delete design_font_meta[id]
        }
    }
    Object.assign(design_font_meta, meta)

    // One entry per family. The doc may hold several for one family (a co-editor adding it at
    // the same moment), and holding the bytes once is what keeps the set one-per-family
    const wanted = new Map<string, StoredFontMeta>()
    for (const entry of Object.values(meta)){
        if (!wanted.has(entry.family)){
            wanted.set(entry.family, entry)
        }
    }
    const released = custom_fonts.filter(font => !wanted.has(font.family))
    for (const font of released){
        release_font(font.family)
    }

    // Download what isn't held yet, keeping it only if the doc still names those files once the
    // download is done (a later snapshot may have moved on while this one waited)
    const added:CustomFont[] = []
    for (const entry of wanted.values()){
        const key = files_key(entry.files)
        if (loaded_files.get(entry.family) === key || loading_files.get(entry.family) === key){
            continue
        }
        loading_files.set(entry.family, key)
        let font:CustomFont
        try {
            font = await load_font_from_meta(entry)
        } finally {
            if (loading_files.get(entry.family) === key){
                loading_files.delete(entry.family)
            }
        }
        const current = Object.values(design_font_meta)
            .some(item => item.family === entry.family && files_key(item.files) === key)
        if (current && loaded_files.get(entry.family) !== key){
            hold_font(font, entry.files)
            added.push(font)
        }
    }
    for (const font of added){
        await register_custom_font_preview(font)
    }
    if (added.length || released.length){
        await push_to_worker()
    }
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
// Uploads the bytes, records them on the design doc, and returns the families now available.
//
// The cover editor hands back its whole font store on every Finished, so a family whose bytes
// the design already holds is the common case: it costs a hash, never an upload (a CJK family
// runs to tens of MB) or a doc write, beyond dropping any duplicate entries left for it.
//
// NOTE The reactive set is updated here rather than left to the design snapshot to refill.
// DialogCoverEditor adds the widget's fonts and then immediately computes
// cover_font_families(), which intersects the form's families with `custom_fonts` — anything
// missing at that moment is silently dropped from the cover. It's recorded just before the
// write, since the write's local snapshot reaches load_design_fonts() at once, which then finds
// these files held rather than downloading them back
export async function add_design_fonts(design_id:string, fonts:CustomFont[]):Promise<string[]> {
    // One font per family, the last given winning
    const by_family = new Map(fonts.map(font => [font.family, font]))

    const updates:unknown[] = []
    const removed:string[] = []
    const entries:[string, StoredFontMeta, CustomFont][] = []
    for (const font of by_family.values()){
        // Paths are content-addressed, so hashing tells whether the design already has these
        const files:string[] = []
        for (const bytes of font.files){
            files.push(`${design_assets_prefix(design_id)}${await hash_bytes(bytes)}.bin`)
        }
        const existing = Object.entries(design_font_meta)
            .filter(([, entry]) => entry.family === font.family)
        const same = existing.find(([, entry]) =>
            entry.style === font.style && files_key(entry.files) === files_key(files))

        // A family the design already has is *replaced*, not kept — re-uploading is how a user
        // fixes a wrong or incomplete file, and silently keeping the old one looks broken. Every
        // other entry for the family goes too, duplicates included. The superseded bytes are
        // reclaimed by the reconcile at the end
        for (const [id] of existing){
            if (id !== same?.[0]){
                updates.push(new FieldPath('fonts', id), deleteField())
                removed.push(id)
            }
        }
        if (same){
            continue
        }

        for (const [i, bytes] of font.files.entries()){
            await uploadBytes(storage_ref(firebase_storage, files[i]!), bytes,
                {contentType: font_mime(bytes)})
        }
        const font_id = generate_token()
        const entry:StoredFontMeta = {family: font.family, style: font.style, files}
        updates.push(new FieldPath('fonts', font_id), entry)
        entries.push([font_id, entry, font])
    }

    if (!updates.length){
        return [...by_family.keys()]
    }

    // Record the outcome locally, then write it
    for (const id of removed){
        delete design_font_meta[id]
    }
    for (const [font_id, entry, font] of entries){
        design_font_meta[font_id] = entry
        hold_font(font, entry.files)
    }
    await updateDoc(doc(firestore, 'designs', design_id),
        updates[0] as FieldPath, updates[1], ...updates.slice(2))

    for (const [, , font] of entries){
        await register_custom_font_preview(font)
    }
    if (entries.length){
        await push_to_worker()
    }
    request_reconcile(design_id)

    return [...by_family.keys()]
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
    release_font(family)
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
        // The entry whose bytes are the ones held, should the doc have more than one
        const held = loaded_files.get(font.family)
        const entry = Object.values(design_font_meta)
            .find(item => item.family === font.family && files_key(item.files) === held)
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
