
// Store of user-uploaded custom fonts (not in the curated typst-fonts manifest). Parsing/
// grouping logic itself lives in typst-fonts' process_font_files (shared with other apps) —
// this module is just the thin Vue-reactive wrapper + browser File reading paper.bible needs

import {reactive} from 'vue'

import {process_font_files} from 'typst-fonts'
import {register_custom_font_preview} from 'typst-fonts/web'

import {typst_generator} from '@/services/typst'

import type {CustomFont, FontStyle} from 'typst-fonts'


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
    return added
}


// Family -> style lookup for BibleContent.resolve()'s custom_font_styles param, which needs a
// custom font's style to correctly match Noto script fallbacks (it can't detect this itself —
// custom fonts are never in the curated manifest get_bundled_font() reads from)
export function get_custom_font_styles():Record<string, FontStyle> {
    return Object.fromEntries(custom_fonts.map(f => [f.family, f.style]))
}
