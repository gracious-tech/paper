
// Reusing a font or cover background from one of the user's other designs.
//
// Assets belong to a design, which is what makes them reclaimable but also means an upload
// isn't automatically available everywhere. These suggestions close that gap where re-picking
// the file is the real cost: a font the user has to find and upload again for every book, and
// a cover background whose file input is inside the widget. Passage images are deliberately
// not offered — choosing a picture for a passage is a fresh decision each time, and the file
// is already to hand. Every other accessible design carries a summary of what it holds (see
// design_assets_summary in designs.ts, derived from the designs listener's own snapshot data),
// so offering them costs no extra reads. Choosing one copies the bytes into the current
// design, which then owns its copy outright — nothing ends up shared between designs.

import {computed} from 'vue'

import {designs, current_design_id} from '@/services/designs'
import {add_design_fonts, load_font_from_meta} from '@/services/custom_fonts'
import {storage_public_url} from '@/services/design_assets'
import {translate} from '@/services/i18n'

import type {StoredFontMeta} from 'paper-bible-typst'


// Most background suggestions to offer the cover editor. Each is a full-resolution cover photo
// shown as a thumbnail, so the list is capped rather than growing with the user's design count
// — `designs` is ordered newest-modified first, making this the covers they worked on recently
const MAX_BG_SUGGESTIONS = 12


// A cover background offered inside the cover editor. `path` stays on this side of the embed
// boundary — it's what the bytes are fetched from once the widget asks for them
export interface CoverBgSuggestion {
    path:string
    hash:string
    url:string
    label:string
}


function other_designs(){
    // Every design except the one being edited — its own assets aren't suggestions
    return designs.filter(design => design.id !== current_design_id.value)
}


export const font_suggestions = computed(() => {
    // Font families from the user's other designs, deduped by family name and excluding any
    // the open design already has (offering a family it can already use would do nothing)
    const here = new Set(designs.find(design => design.id === current_design_id.value)
        ?.assets.fonts.map(font => font.family) ?? [])
    const out:StoredFontMeta[] = []
    for (const design of other_designs()){
        for (const font of design.assets.fonts){
            if (here.has(font.family)){
                continue
            }
            here.add(font.family)
            out.push(font)
        }
    }
    return out
})


export const cover_bg_suggestions = computed(() => {
    // Cover backgrounds from the user's other designs, for the cover editor's own picker. The
    // background file input lives inside that widget, so handing it these is the only way to
    // spare the user hunting down a photo they already used on another book.
    // Only uploads are ever listed (see design_assets_summary) — a builtin is already in the
    // widget's picker, and offering one here would replace the host's reference to a shipped
    // image with a private copy of its bytes
    const seen = new Set<string>()
    const current = designs.find(design => design.id === current_design_id.value)
    if (current?.assets.cover_bg){
        seen.add(current.assets.cover_bg.hash)
    }
    const out:CoverBgSuggestion[] = []
    for (const design of other_designs()){
        const bg = design.assets.cover_bg
        if (!bg || seen.has(bg.hash)){
            continue
        }
        seen.add(bg.hash)
        out.push({...bg, url: storage_public_url(bg.path),
            label: design.name || translate('common.unnamed_design')})
        if (out.length === MAX_BG_SUGGESTIONS){
            break
        }
    }
    return out
})


export async function adopt_font(font:StoredFontMeta, design_id:string):Promise<void> {
    // Copy another design's font family into this one. The bytes have to come through the
    // browser rather than being copied in the bucket, because they also have to be registered
    // for preview and handed to the compiler worker — so they're loaded either way
    await add_design_fonts(design_id, [await load_font_from_meta(font)])
}
