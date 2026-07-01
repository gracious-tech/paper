
// Stateful Bible-content layer: owns a single fetch-client + collection + a cache of fetched
// Typst books, and resolves a user Blueprint into a fully-resolved TypstRequest. The same
// instance backs both the in-browser app (which also reads `collection` for its UI) and the
// server (Node) pipeline, so a Blueprint "just works" in either place with no extra fetch code.

import {FetchClient, PassageReference} from '@gracious.tech/fetch-client'
import {get_common_sizes, get_service} from 'printing-services'

import {prose_to_typst, replace_copyright_marker} from './prose.js'
import {gen_copyright_typst} from './copyright.js'
import {resolve_icon} from './icon_cache.js'
import {PATTERNS} from './generated/patterns.js'

import type {BibleCollection, BibleBookTypst, GetResourcesItem,
    } from '@gracious.tech/fetch-client'
import type {Blueprint, ContentPassage, ContentTitle, ContentCustom, TypstRequest,
    TypstContentItem, TypstPassage, TypstTitlePage, TypstCustomPage, BiblePassageData,
    PageConfig} from './types.js'


// Default Bible content API endpoint (production fetch.bible)
const DEFAULT_ENDPOINT = 'https://v1.fetch.bible/'


// Options for constructing a BibleContent instance
export interface BibleContentOptions {
    // Bible content API endpoint (ignored if `collection` is supplied)
    endpoint?:string
    // Reuse an already-loaded collection (e.g. the app shares its own) instead of fetching one
    collection?:BibleCollection
    // Title-page decorative patterns, keyed by pattern name → corner SVG string. Defaults to
    // the bundled PATTERNS, so callers (incl. the server) get decorated titles for free.
    patterns?:Record<string, string>
}


// Map printing-services' unit string ('mm'|'inch') to the typst unit ('mm'|'in')
function norm_unit(unit:string):'mm'|'in' {
    return unit === 'mm' ? 'mm' : 'in'
}


// Resolves user Blueprints into TypstRequests, fetching + caching Bible content as needed
export class BibleContent {

    private client:FetchClient|null
    private _collection:BibleCollection|null
    private patterns:Record<string, string>
    // Cache of fetched Typst books, keyed `${bible}_${book}`
    private books_typst = new Map<string, BibleBookTypst>()

    constructor(opts:BibleContentOptions = {}) {
        this._collection = opts.collection ?? null
        this.client = this._collection
            ? null
            : new FetchClient({endpoints: [opts.endpoint ?? DEFAULT_ENDPOINT]})
        this.patterns = opts.patterns ?? PATTERNS
    }

    // Fetch the Bible collection (skipped if one was injected). Must be awaited before use.
    async init():Promise<void> {
        if (!this._collection) {
            this._collection = (await this.client!.fetch_collection()).bibles
        }
    }

    // The underlying collection, exposed so the app can drive its UI from the same instance
    get collection():BibleCollection {
        if (!this._collection) {
            throw new Error('BibleContent.init() must be awaited before use')
        }
        return this._collection
    }

    // Load a translation's extras (local book names, words-of-Jesus support)
    async load_translation(bible:string):Promise<{wj_markup:boolean}> {
        const extra = await this.collection.fetch_translation_extras(bible)
        return {wj_markup: extra.wj_markup}
    }

    // Fetch (and cache) the Typst content for one book of one translation, or null if the book
    // is unavailable in that translation
    async fetch_book(bible:string, book:string):Promise<BibleBookTypst|null> {
        const key = `${bible}_${book}`
        const cached = this.books_typst.get(key)
        if (cached) {
            return cached
        }
        if (!this.collection.get_books(bible, {object: true})[book]?.available) {
            return null
        }
        const instance = await this.collection.fetch_book(bible, book, 'typst')
        this.books_typst.set(key, instance)
        return instance
    }

    // Pre-fetch every Typst book the blueprint's passages need (keeps the live preview snappy)
    async prefetch(blue:Blueprint):Promise<void> {
        const books = [...new Set(blue.content
            .filter((i):i is ContentPassage => i.type === 'passage')
            .map(i => i.book))]
        const jobs:Promise<unknown>[] = []
        for (const bible of blue.bibles) {
            for (const book of books) {
                jobs.push(this.fetch_book(bible, book))
            }
        }
        await Promise.all(jobs)
    }

    // Resolve a Blueprint into a fully-resolved TypstRequest, fetching any missing content
    async resolve(blue:Blueprint):Promise<TypstRequest> {

        // License metadata for the copyright statement (computed once, shared by custom pages)
        const resources = this.collection.get_resources({object: true})

        // Map supported content items (study notes/crossrefs are not yet supported, skipped)
        const items:TypstContentItem[] = []
        for (const item of blue.content) {
            if (item.type === 'passage') {
                items.push(await this.gen_passage_item(blue, item))
            } else if (item.type === 'title') {
                items.push(await this.gen_title_item(item))
            } else if (item.type === 'custom') {
                items.push(this.gen_custom_item(blue, item, resources))
            }
        }

        return {
            title: blue.title,
            page: this.gen_page(blue),
            typography: {
                font_family: blue.font_family,
                font_fallbacks: [],
                font_size: `${blue.font_size}pt`,
                line_height: blue.line_height,
                justify: blue.justify,
                text_color: blue.text_color,
            },
            features: {
                show_chapters: blue.show_chapters,
                show_chapters_style: blue.show_chapters_style,
                show_verses: blue.show_verses,
                show_wj: blue.show_wj,
                show_wj_color: blue.show_wj_color,
                show_wj_bold: blue.show_wj_bold,
                show_wj_italic: blue.show_wj_italic,
            },
            content: items,
            arrangement: blue.booklet ? 'booklet' : 'book',
            show_pages: blue.show_pages,
            booklet_portrait: blue.booklet_portrait,
        }
    }

    // Resolve the chosen trim size + margins to a concrete PageConfig of Typst unit strings
    private gen_page(blue:Blueprint):PageConfig {
        const trim = this.resolve_trim(blue)
        return {
            // Trim/page size; booklet imposition is handled downstream
            width: `${trim.width}${trim.unit}`,
            height: `${trim.height}${trim.unit}`,
            margin_top: `${blue.margin_top}${blue.margin_unit}`,
            margin_bottom: `${blue.margin_bottom}${blue.margin_unit}`,
            // Inner/outer map to typst's left/right + swap (inside/outside binding)
            margin_left: `${blue.margin_inner}${blue.margin_unit}`,
            margin_right: `${blue.margin_outer}${blue.margin_unit}`,
            margin_swap: blue.margin_swap,
        }
    }

    // Work out the interior page dimensions from the selected printing service + named size,
    // or the manually entered custom dimensions
    private resolve_trim(blue:Blueprint):{width:number, height:number, unit:'mm'|'in'} {

        // Custom dimensions (no named size selected)
        const custom = {
            width: blue.custom_trim_width,
            height: blue.custom_trim_height,
            unit: norm_unit(blue.custom_unit),
        }
        if (blue.size_id === '') {
            return custom
        }

        // Named size: from the common list for the service-less modes (home/custom), else service
        const use_common = blue.service_id === 'custom' || blue.service_id === 'home'
        const sizes = use_common
            ? get_common_sizes({numbers: 'number'})
            : get_service(blue.service_id as Parameters<typeof get_service>[0])
                .get_sizes({numbers: 'number', all: true})
        const size = sizes.find(s => s.id === blue.size_id)
        if (!size) {
            // Size id not offered by this service — fall back to the custom dimensions
            return custom
        }
        return {width: size.width, height: size.height, unit: norm_unit(size.unit)}
    }

    // Build the resolved Typst content for each translation of a passage
    private async gen_passage_bibles(
        blue:Blueprint, passage:ContentPassage,
    ):Promise<BiblePassageData[]> {
        const ref = new PassageReference(passage)
        const bibles:BiblePassageData[] = []

        // Collect content for each selected translation that has this book available
        for (const bible of blue.bibles) {
            const instance = await this.fetch_book(bible, passage.book)
            if (!instance) {
                continue
            }
            bibles.push({content: instance.get_passage_from_ref(ref, {attribute: false})})
        }

        // Guarantee at least one entry so the renderer always has content to work with
        if (!bibles.length) {
            bibles.push({content: ''})
        }
        return bibles
    }

    // Convert a passage content item to its Typst equivalent
    private async gen_passage_item(
        blue:Blueprint, passage:ContentPassage,
    ):Promise<TypstPassage> {
        return {
            type: 'passage',
            bibles: await this.gen_passage_bibles(blue, passage),
            multi_layout: blue.bibles_layout,
            half_blank: blue.half_blank,
            show_headings: blue.show_headings,
            show_footnotes: blue.show_footnotes,
            // Markers are hidden by default (verse references serve as the reference instead)
            show_footnote_calls: false,
            show_lines: blue.show_lines,
            // null = auto-detect by book, true = 2 columns, false = single column
            columns: blue.columns === null ? 'auto' : (blue.columns ? 2 : 1),
            column_gap: `${blue.column_gap}${blue.margin_unit}`,
            book: passage.book,
            passage_title: passage.title
                ? this.collection.reference_to_string(new PassageReference(passage), blue.bibles[0])
                : null,
            alone: false,
        }
    }

    // Convert a title content item to its Typst equivalent
    private async gen_title_item(title:ContentTitle):Promise<TypstTitlePage> {
        const color_secondary = title.color_secondary ?? '#000000'

        // Resolve the Iconify ID (or raw SVG) to a recolored SVG; ignore a failed fetch so a bad
        // icon ID never breaks the whole document (the title just renders without an icon)
        let icon:string|null = null
        if (title.icon) {
            try {
                icon = await resolve_icon(title.icon, color_secondary)
            } catch {
                icon = null
            }
        }

        return {
            type: 'title',
            title: title.title,
            subtitle: title.subtitle,
            icon,
            icon_size: title.icon_size ?? 1,
            // Raw pattern SVG — the renderer substitutes the secondary colour itself
            pattern_svg: this.patterns[title.pattern] ?? null,
            color_primary: title.color_primary ?? '#000000',
            color_secondary,
            alone: title.alone,
        }
    }

    // Convert a custom (rich text) content item to its Typst equivalent
    private gen_custom_item(
        blue:Blueprint, custom:ContentCustom, resources:Record<string, GetResourcesItem>,
    ):TypstCustomPage {
        let markup = prose_to_typst(custom.doc)

        // Replace the AUTO-COPYRIGHT marker with the generated copyright block
        markup = replace_copyright_marker(markup, gen_copyright_typst(blue, resources))

        return {
            type: 'custom',
            content: markup,
            position: custom.position,
        }
    }
}
