
// Detects which Noto fallback font families a resolved request's text actually needs, so
// preamble.ts's document-wide font list can render scripts beyond the user's chosen curated
// font without embedding the full Noto set. Matching the fallback style (serif/sans) to the
// chosen body font needs the curated manifest (font_style()), which callers are expected to
// load before resolving a Blueprint — the app and typst-web both already do this independently
// (font picker / compiler init), and typst-node's compile_pdf_from_blueprint loads fonts first
// for the same reason. safe_font_style() degrades to 'serif' rather than throwing for any
// caller that hasn't (e.g. resolving without a fonts_dir configured at all).

import {resolve_fallback_chain, detect_cjk_variant, font_style, script_family} from 'typst-fonts'

import type {CjkVariant, FontStyle} from 'typst-fonts'
import type {TypstContentItem} from './types.js'


// font_style() throws if init_fonts() hasn't run yet, unless `explicit` is given (in which case
// it short-circuits before ever touching the manifest) — treat an uninitialised manifest as
// "unknown, assume serif" rather than letting script detection fail a whole document resolve.
// `explicit` is how a caller-supplied custom (user-uploaded) font's real style reaches here —
// custom fonts are never in the curated manifest, so get_bundled_font() alone can't see them.
function safe_font_style(family:string, explicit?:FontStyle):FontStyle {
    try {
        return font_style(family, explicit)
    } catch {
        return explicit ?? 'serif'
    }
}

// Scripts always included regardless of detection, matched to the chosen body font's style via
// script_family(): Greek resolves to the base Noto Sans/Serif family itself (no dedicated Greek
// family), and Hebrew (also covers biblical Aramaic, written in Hebrew script) — both are common
// in original-language glosses within study notes (see the #greek/#hebrew/#aramaic passthroughs
// in preamble.ts)
const ALWAYS_SCRIPTS = ['Greek', 'Hebrew']

// Cap on how much of a passage's first paragraph gets scanned — a safety net for content with
// no early blank line (e.g. one long poetic passage), keeping detection cheap even on huge books
const FIRST_PARA_CAP = 2000

// Extract a cheap leading sample of a passage's Typst markup: up to the first blank line
// (paragraph break), capped so a single huge paragraph can't force a full-book scan
function first_paragraph(text:string):string {
    const blank = text.search(/\n\s*\n/)
    const end = blank === -1 ? text.length : blank
    return text.slice(0, Math.min(end, FIRST_PARA_CAP))
}

// Gather the text samples worth scanning for script detection, for one translation "slot" (0 =
// primary, 1 = second translation). Passages/picture-story slides carry one sample per slot
// (sampled by first paragraph only — full books are too large to scan cheaply and the language
// mix rarely changes mid-book); title and custom content have no per-translation slot of their
// own, so they're only sampled for slot 0 (they render under the document's primary font scope,
// see preamble.ts, never the second-translation scope in gen_multi_bible_grids)
function gather_samples(items:TypstContentItem[], slot:0|1):string[] {
    const samples:string[] = []
    for (const item of items) {
        if (item.type === 'passage') {
            const bible = item.bibles[slot]
            if (bible) {
                samples.push(first_paragraph(bible.content))
            }
        } else if (item.type === 'picture_story') {
            for (const slide of item.slides) {
                const body = slot === 0 ? slide.body : slide.body2
                if (body) {
                    samples.push(first_paragraph(body))
                }
            }
        } else if (slot === 0 && item.type === 'title') {
            samples.push(`${item.title} ${item.subtitle}`)
        } else if (slot === 0 && item.type === 'custom') {
            samples.push(item.content)
        }
    }
    return samples
}

// Detect the full set of Noto fallback families one translation slot's content needs: the
// always-needed set (slot 0 only — Greek/Hebrew glosses belong to the primary content flow) plus
// whatever resolve_fallback_chain finds in the sampled text, matched in style to the document's
// chosen body font. `explicit_style` overrides curated-manifest lookup entirely — pass it when
// font_text is a custom (user-uploaded) font, whose style a caller already knows but which
// get_bundled_font() can never resolve on its own. `declared_variant` overrides the sampled-text
// CJK region guess entirely — pass it when the translation's manifest metadata (fetch.bible's
// `script`/`region` fields) already states the region unambiguously (e.g. Hong Kong vs Taiwan
// Traditional Chinese, which share the same characters and so can never be told apart from the
// text alone).
export function detect_font_fallbacks(
    items:TypstContentItem[], font_text:string, explicit_style?:FontStyle, slot:0|1 = 0,
    declared_variant?:CjkVariant,
):string[] {
    const style = safe_font_style(font_text, explicit_style)
    const always = slot === 0
        ? ALWAYS_SCRIPTS
            .map(script => script_family(script, style))
            .filter((family):family is string => family !== null)
        : []
    const families = new Set(always)
    const samples = gather_samples(items, slot)
    if (samples.length === 0) {
        return [...families]
    }

    // One shared han_variant tiebreaker for this slot, from its own declared metadata if known,
    // else detected from all its sampled text
    const han_variant = declared_variant ?? detect_cjk_variant(samples.join('\n'))

    for (const sample of samples) {
        for (const family of resolve_fallback_chain(sample, han_variant, style)) {
            families.add(family)
        }
    }
    return [...families]
}
