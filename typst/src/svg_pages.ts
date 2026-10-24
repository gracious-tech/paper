
// A preview as one standalone SVG per page, for phones: they can't show a PDF inside a page
// (Android's browsers not at all, iOS only its first page), but show an SVG as an ordinary
// image. Pages are assembled exactly as print assembles them (see assemble.ts), just in reading
// order, one page at a time — a phone's screen is too narrow for facing-page spreads.
//
// Each page carries only the glyphs, gradients and clip paths it uses, so it renders on its own
// as an <img>, where its styles can't reach the page around it and the browser decides when to
// decode it.

import {assemble_reading_preview} from './assemble.js'

import type {PageBackend} from './assemble.js'
import type {TypstRequest, ProgressFn} from './types.js'


// One page of an SVG preview: the markup drawn on it, and which part of it is shown, in points.
// x is non-zero only for the right half of a page split down the middle (see svg_page_half)
export interface SvgPage {
    inner:string
    x:number
    width:number
    height:number
}


// Compiles one Typst source to its pages (see split_typst_svg)
export type SvgCompileFn = (source:string, assets?:Record<string, Uint8Array>)
    => Promise<SvgPage[]>


// Every element under <defs> with an id, keyed by it: typst.ts gives glyphs, gradients and clip
// paths content-derived ids, so the same id from two documents is the same thing
const DEF_ELEMENT = /<(\w+)\s+id="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g

// A reference from markup to a definition, by href or by url()
const DEF_REFERENCE = /(?:href="#|url\(#)([^")]+)/g

// Where each page starts in typst.ts's SVG of a whole document, where pages are stacked down one
// tall canvas as top-level groups
const PAGE_START = '<g class="typst-page"'


export function split_typst_svg(svg:string):SvgPage[] {
    // Split typst.ts's SVG of a whole document (rendered from a vector artifact) into its pages,
    // each moved to the origin and given exactly the definitions it references. Its text
    // selection layer (foreignObject) and per-node ids (data-tid) are dropped: an image preview
    // needs neither, and they make up much of the markup
    const defs = new Map<string, string>()
    for (const block of svg.matchAll(/<defs\b[^>]*>([\s\S]*?)<\/defs>/g)) {
        for (const element of block[1]!.matchAll(DEF_ELEMENT)) {
            defs.set(element[2]!, element[0])
        }
    }

    const pages:SvgPage[] = []
    let start = svg.indexOf(PAGE_START)
    while (start !== -1) {
        const next = svg.indexOf(PAGE_START, start + PAGE_START.length)
        const end = next === -1 ? svg.lastIndexOf('</svg>') : next
        const markup = svg.slice(start, end)
        const open = markup.slice(0, markup.indexOf('>') + 1)
        const width = Number(/data-page-width="([\d.]+)"/.exec(open)?.[1] ?? 0)
        const height = Number(/data-page-height="([\d.]+)"/.exec(open)?.[1] ?? 0)
        const body = '<g>' + markup.slice(open.length)
            .replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')
            .replace(/ data-tid="[^"]*"/g, '')
        pages.push({inner: with_definitions(body, defs), x: 0, width, height})
        start = next
    }
    return pages
}


function with_definitions(body:string, defs:Map<string, string>):string {
    // Prefix a page's markup with the definitions it references, and any they reference in turn
    const needed = new Set<string>()
    const pending = [body]
    while (pending.length) {
        for (const reference of pending.pop()!.matchAll(DEF_REFERENCE)) {
            const id = reference[1]!
            const definition = defs.get(id)
            if (definition && !needed.has(id)) {
                needed.add(id)
                pending.push(definition)
            }
        }
    }
    const used = [...needed].map(id => defs.get(id)).join('')
    return (used ? `<defs>${used}</defs>` : '') + body
}


export function parse_standalone_svg(svg:string):SvgPage {
    // A page as the Typst CLI writes it (one file per page, each already carrying its own
    // definitions): its markup, sized from the root's viewBox
    const open_end = svg.indexOf('>', svg.indexOf('<svg')) + 1
    const view_box = /viewBox="([^"]+)"/.exec(svg.slice(0, open_end))?.[1] ?? '0 0 0 0'
    const [x, , width, height] = view_box.trim().split(/[\s,]+/).map(Number)
    return {inner: svg.slice(open_end, svg.lastIndexOf('</svg>')), x: x ?? 0, width: width ?? 0,
        height: height ?? 0}
}


export function svg_page_half(page:SvgPage, side:'left'|'right'):SvgPage {
    // One half of a page split down the middle (a facing-pages passage is compiled double-width,
    // see process_facing): the same markup, showing only that half
    const width = page.width / 2
    return {...page, width, x: side === 'left' ? page.x : page.x + width}
}


export function svg_page_markup(page:SvgPage):string {
    // A page as a standalone SVG document, sized in points. Shapes typst.ts leaves unfilled rely
    // on its stylesheet's `svg {fill: none}`, which is all of it a page needs
    const {x, width, height} = page
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
        + ` viewBox="${x} 0 ${width} ${height}" width="${width}pt" height="${height}pt">`
        + `<style>svg{fill:none}</style>${page.inner}</svg>`
}


// The assembly backend for an SVG preview (see assemble.ts)
function svg_backend(compile_fn:SvgCompileFn):PageBackend<SvgPage[]> {
    return {
        compile: compile_fn,
        page_count: doc => doc.length,
        split_halves: async doc => doc.flatMap(page =>
            [svg_page_half(page, 'left'), svg_page_half(page, 'right')]),
    }
}


export async function generate_svg_preview(request:TypstRequest, compile_fn:SvgCompileFn,
        on_progress?:ProgressFn):Promise<SvgPage[]> {
    // A request's pages in reading order, every blank and notes page included, as a preview
    // shows them (see assemble_reading_preview) — one SvgPage each
    const {assembly} = await assemble_reading_preview(request, svg_backend(compile_fn),
        on_progress)
    on_progress?.({stage: 'finalize'})
    return assembly.pages.map(({doc, index}) => doc[index]!)
}
