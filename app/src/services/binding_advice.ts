
// Choosing a binding for a document, and warning when its length doesn't suit the one chosen.
//
// Separate from blueprints.ts because this isn't about what a blueprint *is* — it's the advice
// layer over it: which binding a service will actually accept at a given page count, and what
// the user can change when a document is too long for one. Nothing here mutates a blueprint;
// callers apply what they're given (see the watcher in watchers.ts and DialogPageSuggestions).
//
// Page counts arriving here are estimates while designing and actual once compiled — see
// auto_binding for why erring low is the safe direction.

import {get_service} from 'printing-services'

import {unit_label} from '@/services/blueprints'

import type {BindingTypeId, SizeId, InkTypeId, PaperTypeId} from 'printing-services'
import type {Blueprint} from '@/services/types'
import type {Translate} from '@/services/i18n'


// Describes how a page count fails a binding's supported range: too few pages (below
// `min_pages`) or too many (above `max_pages`), and the limit that was crossed. Includes the
// binding's display name since warnings may be shown away from the binding selector itself
export interface BindingPageIssue {
    name:string
    fewer:boolean
    limit:number
}


// Whether a blueprint's chosen binding doesn't support the given page count, and if so whether
// the document has too few or too many pages for it. Used for warnings only — the binding is
// never auto-switched, as page count is derived from the document (estimated during design,
// actual once compiled). Home/custom modes and services without a defined range for the chosen
// binding have no such constraint to violate
export function binding_page_issue(blueprint:Blueprint, pages:number):BindingPageIssue|null{
    if (blueprint.service_id === 'home' || blueprint.service_id === 'custom'){
        return null
    }
    const service = get_service(blueprint.service_id as Parameters<typeof get_service>[0])
    const limits = service?.raw.binding_types[blueprint.binding_type as BindingTypeId]
    if (!service || !limits){
        return null
    }
    const name = service.get_binding_types().find(b => b.id === blueprint.binding_type)?.name
        ?? blueprint.binding_type
    if (pages < limits.min_pages){
        return {name, fewer: true, limit: limits.min_pages}
    }
    if (pages > limits.max_pages){
        return {name, fewer: false, limit: limits.max_pages}
    }
    return null
}


// Binding types a design could use, in order of preference — the first one the service supports
// at the document's length wins (see auto_binding). A design with a blank half to write on
// prefers coil (it lies flat under a pen), everything else perfect bound. Saddle stitch comes
// last in both: it's only for documents too thin for any proper book binding
function binding_preference(blueprint:Blueprint):BindingTypeId[]{
    return blueprint.half_blank !== null
        ? ['paperback_coil', 'paperback', 'paperback_stitch']
        : ['paperback', 'paperback_stitch']
}


// The binding that suits a document of `pages` pages: the first preference the chosen service
// actually supports at that length.
// `pages` is the preview's estimate, which can undercount the printed document by a page or two
// (a preview drops the run of blank pages at the very end that a printed copy keeps — see
// generate_pdf's `preview` flag) and never overcounts. That only ever errs towards the thinner
// binding, which is the safe direction here: saddle stitch is only reached below the preferred
// binding's minimum, well inside saddle stitch's own maximum (32 vs 48 pages on Lulu), so a
// document that prints longer than estimated stays within whatever was chosen for it.
// Only used for wizard/simple-mode designs, which is why the preference list can stay this
// short — the wizard offers Lulu as its only printing service (see NewDesignPrint.vue), and
// home/custom modes have no service to ask, so their binding is left untouched
export function auto_binding(blueprint:Blueprint, pages:number|null):string{
    if (blueprint.service_id === 'home' || blueprint.service_id === 'custom'){
        return blueprint.binding_type
    }
    const service = get_service(blueprint.service_id as Parameters<typeof get_service>[0])
    if (!service){
        return blueprint.binding_type
    }
    const preference = binding_preference(blueprint)

    // Page count not known yet (nothing compiled since the design was opened) — assume a book of
    // real length, i.e. the top preference. Most designs are whole books, and a thin one is
    // corrected as soon as the first preview estimate lands (see the watcher in watchers.ts)
    if (pages === null){
        return preference[0]!
    }

    // Which bindings the service supports for this document — page count, trim size (omitted
    // for custom dimensions) and the ink/paper already chosen, since a binding can exclude
    // those (Lulu's saddle stitch doesn't take standard color ink)
    const supported = service.get_binding_types({
        pages,
        ...blueprint.size_id && {size: blueprint.size_id as SizeId},
        ...blueprint.ink_type && {ink_type: blueprint.ink_type as InkTypeId},
        ...blueprint.paper_type && {paper_type: blueprint.paper_type as PaperTypeId},
    }).map(item => item.id)

    // Nothing fits — a document past every binding's maximum, or under every minimum. Leave the
    // top preference in place (never saddle stitch, the narrowest range of the lot) and let
    // binding_page_issue() warn that the length itself is the problem
    return preference.find(id => supported.includes(id)) ?? preference[0]!
}


// A single tweak the user can opt into from a page-limit warning's "Suggestions" dialog: a
// short already-translated label and the blueprint patch it applies when ticked
export interface PageSuggestion {
    id:string
    text:string
    patch:Partial<Blueprint>
}


// Next sensible value when reducing a numeric style setting: a comfortable target first, then a
// tighter floor once already at/below comfortable, then null once nothing more is worth shaving
function reduce_step(current:number, comfortable:number, floor:number):number|null{
    if (current > comfortable){
        return comfortable
    }
    if (current > floor){
        return floor
    }
    return null
}


// Small styling tweaks offered from a page-limit warning (the estimate box while designing, or
// the post-compile binding / booklet-sheet alerts) to help a document fit without touching the
// content itself. Each entry is only included when it would actually shrink the current
// blueprint — nothing suggests a value the design is already at or past. Bigger reductions
// (removing passages, splitting into multiple books) are out of scope and called out in the
// dialog's intro text instead
export function page_reduction_suggestions(blueprint:Blueprint, t:Translate):PageSuggestion[]{
    const out:PageSuggestion[] = []

    // Two columns fit far more text per page. Skipped when already on, or when two translations
    // in a columns layout have forced two columns anyway (the option is disabled in that case)
    const forced_two_col = blueprint.bibles_layout === 'columns' && blueprint.bibles.length > 1
    if (blueprint.columns !== true && !forced_two_col){
        out.push({id: 'columns', text: t('page_suggestions.columns'), patch: {columns: true}})
    }

    // Loosen how two translations line up — aligning by paragraph rather than verse lets each
    // text flow with less forced whitespace
    if (blueprint.bibles.length > 1 && blueprint.bibles_align === 'verse'){
        out.push({id: 'bibles_align', text: t('page_suggestions.align_paragraph'),
            patch: {bibles_align: 'paragraph'}})
    }

    // Turn off translator footnotes. Study notes already force them off, so nothing to gain
    // (or offer) while notes are on
    if (blueprint.show_footnotes && !blueprint.notes){
        out.push({id: 'footnotes', text: t('page_suggestions.footnotes'),
            patch: {show_footnotes: false}})
    }

    // Tighten margins — all four together, lowering only the ones above the target. The label
    // quotes the current largest margin, not all four. The floor stays at 10mm even for print
    // services: consumer printers can't image up to the sheet edge, and it's a safe stopping
    // point everywhere
    const unit = unit_label(blueprint.margin_unit)
    const [margin_comfortable, margin_floor] =
        blueprint.margin_unit === 'mm' ? [12, 10] : [0.5, 0.4]
    const margin_max = Math.max(blueprint.margin_top, blueprint.margin_bottom,
        blueprint.margin_inner, blueprint.margin_outer)
    const margin_target = reduce_step(margin_max, margin_comfortable, margin_floor)
    if (margin_target !== null){
        out.push({id: 'margins',
            text: t('page_suggestions.margins', {current: margin_max, value: margin_target, unit}),
            patch: {
                margin_top: Math.min(blueprint.margin_top, margin_target),
                margin_bottom: Math.min(blueprint.margin_bottom, margin_target),
                margin_inner: Math.min(blueprint.margin_inner, margin_target),
                margin_outer: Math.min(blueprint.margin_outer, margin_target),
            }})
    }

    // Tighten line height
    const line_target = reduce_step(blueprint.line_height, 1.3, 1.2)
    if (line_target !== null){
        out.push({id: 'line_height',
            text: t('page_suggestions.line_height',
                {current: Math.round(blueprint.line_height * 100) / 100, value: line_target}),
            patch: {line_height: line_target}})
    }

    // Shrink the main text size (any second translation is sized relative to it, so it follows)
    const font_target = reduce_step(blueprint.font_size, 9, 8)
    if (font_target !== null){
        out.push({id: 'font_size',
            text: t('page_suggestions.font_size',
                {current: Math.round(blueprint.font_size * 10) / 10, value: font_target}),
            patch: {font_size: font_target}})
    }

    return out
}
