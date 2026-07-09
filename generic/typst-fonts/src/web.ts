
// Web-only helpers: load a curated font manifest over HTTP, and build/fetch font URLs +
// blob URLs for a browser-based Typst compiler (e.g. typst.ts). Does not depend on any
// specific compiler library — the caller wires the returned blob URLs into whatever
// loadFonts()-style API it uses.

import {init_fonts, get_bundled_font, get_noto_font} from './index.js'

import type {BundledFont, CustomFont} from './index.js'

// Join a base URL/path with segments, collapsing a trailing slash on the base
function join_path(base:string, ...segments:string[]):string {
    return [base.replace(/\/+$/, ''), ...segments].join('/')
}

// Fetches manifest.json from fonts_prefix and calls init_fonts. Only the curated manifest is
// runtime-loaded — Noto's own manifest/fallback data is bundled with the package.
export async function load_fonts_prefix(fonts_prefix:string):Promise<void> {
    const resp = await fetch(join_path(fonts_prefix, 'manifest.json'))
    if (!resp.ok) {
        throw new Error(`[typst-fonts] Failed to fetch ${join_path(fonts_prefix, 'manifest.json')}: HTTP ${resp.status}`)
    }
    const font_manifest = await resp.json()
    init_fonts({font_manifest})
}

// URL of a single font file within a published fonts tree: curated fonts at
// <fonts_prefix>/<family>/<file>, Noto fallback families at <fonts_prefix>/_noto/<family>/<file>
export function font_file_url(fonts_prefix:string, family:string, file:string, is_noto:boolean):string {
    return is_noto
        ? join_path(fonts_prefix, '_noto', encodeURIComponent(family), file)
        : join_path(fonts_prefix, encodeURIComponent(family), file)
}

// All file URLs needed for a set of font families (curated + Noto fallback alike). Requires
// load_fonts_prefix() to have run first.
export function font_urls_for(fonts_prefix:string, families:string[]):string[] {
    const urls:string[] = []
    for (const family of families) {
        const bundled = get_bundled_font(family)
        const noto = bundled ? undefined : get_noto_font(family)
        const font = bundled ?? noto
        if (!font) continue
        for (const file of font.files) {
            urls.push(font_file_url(fonts_prefix, family, file, !bundled))
        }
    }
    return urls
}

// Register a FontFace for each curated font's preview (400-weight) file, so CSS elsewhere in the
// app can render text with `font-family: <family>` and have the browser fetch the file lazily on
// first use — only when that family actually appears in rendered DOM text, no eager download.
export function register_preview_fonts(fonts_prefix:string, fonts:BundledFont[]):void {
    for (const font of fonts) {
        const url = font_file_url(fonts_prefix, font.family, font.preview_file, false)
        document.fonts.add(new FontFace(font.family, `url("${url}")`))
    }
}


// Register a FontFace for a custom (user-uploaded) font's preview (first file), mirroring
// register_preview_fonts above but from already-in-memory bytes rather than a fetched URL
export async function register_custom_font_preview(font:CustomFont):Promise<void> {
    const data = font.files[0]
    if (!data)
        return
    // .slice() copies out exactly this view's bytes as their own Uint8Array/ArrayBuffer, since
    // .buffer could be a larger backing buffer (or, per lib.dom's types, a SharedArrayBuffer —
    // not assignable to FontFace's BufferSource param)
    const face = new FontFace(font.family, data.slice())
    await face.load()
    document.fonts.add(face)
}


// Fetch a single font file's raw bytes
export async function fetch_font_bytes(url:string):Promise<Uint8Array> {
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`[typst-fonts] Failed to fetch font ${url}: HTTP ${resp.status}`)
    }
    return new Uint8Array(await resp.arrayBuffer())
}

// Wrap font byte arrays as Blob URLs, e.g. for typst.ts's loadFonts()
export function fonts_to_blob_urls(bytes:Uint8Array[], mime = 'font/ttf'):string[] {
    return bytes.map(data => URL.createObjectURL(new Blob([data as BlobPart], {type: mime})))
}

// Revoke a set of blob URLs created by fonts_to_blob_urls()
export function revoke_blob_urls(urls:string[]):void {
    for (const url of urls) {
        URL.revokeObjectURL(url)
    }
}
