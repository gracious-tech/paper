
// Stateful Bible-content layer: owns a single fetch-client + collection + a cache of fetched
// Typst books, and resolves a user Blueprint into a fully-resolved TypstRequest. The same
// instance backs both the in-browser app (which also reads `collection` for its UI) and the
// server (Node) pipeline, so a Blueprint "just works" in either place with no extra fetch code.

import {FetchClient, PassageReference} from '@gracious.tech/fetch-client'

import {LruCache, estimate_bytes, escape_typst, emphasize_sentences} from './helpers.js'
import {resolve_trim, convert_unit, resolve_binding_gutter} from './trim.js'
import {prose_to_typst, replace_copyright_marker} from './prose.js'
import {gen_copyright_typst} from './copyright.js'
import {resolve_icon} from './icon_cache.js'
import {resolve_passage_image} from './image_cache.js'
import {PATTERNS} from './generated/patterns.js'
import {inject_study_notes} from './content_notes.js'
import {detect_font_fallbacks} from './fonts_detect.js'

import type {CjkVariant, FontStyle} from 'typst-fonts'
import type {QuoteState} from './helpers.js'
import type {BibleCollection, BibleBookTypst, BibleBookTxt, GetResourcesItem,
    } from '@gracious.tech/fetch-client'
import type {Blueprint, ContentPassage, ContentCustom, ContentPictureStory, TypstRequest,
    TypstContentItem, TypstPassage, TypstTitlePage, TypstCustomPage, TypstPictureStory,
    TypstPictureStorySlide, BiblePassageData, PageConfig, TypstNotesFile, ProgressFn,
    TitlepageConfig} from './types.js'


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
    // Coarse progress reporting (which book is being fetched)
    on_progress?:ProgressFn
    // Byte cap for the fetched books/notes caches (LRU eviction); omitted = unbounded, which
    // suits the browser (one session, few translations) — long-lived servers should set a cap
    cache_max_bytes?:number
    // Re-fetch a book/notes file when its cache entry is older than this many ms; omitted = keep
    // until LRU-evicted. Book content is effectively static, so this mainly bounds how long a
    // long-lived server can serve a book after it's corrected/removed upstream
    cache_ttl_ms?:number
    // Re-fetch the collection manifest (list of available translations) when older than this many
    // ms; omitted = fetch once, keep forever. Ignored when a collection was injected via
    // `collection`
    manifest_ttl_ms?:number
}


// Resolve a translation's declared CJK region variant from its fetch.bible manifest metadata
// (script:'Hans'|'Hant' + optional region:'HK', both ISO 15924/3166-1), when the manifest
// states it unambiguously — undefined falls through to sampled-text detection in
// detect_font_fallbacks. Japanese/Korean are resolved from the language code alone (kana/hangul
// already make them unambiguous to detect from text, so there's nothing for script/region to
// disambiguate); Hong Kong vs Taiwan Traditional Chinese share the same characters and so can
// never be told apart from sampled text alone — 'Hant' without a declared 'HK' region defaults
// to 'TC', matching resolve_fallback_chain's own default when no manifest tag exists at all.
export function resolve_declared_cjk_variant(
    resource:GetResourcesItem|undefined,
):CjkVariant|undefined {
    if (!resource) {
        return undefined
    }
    if (resource.language === 'jpn') {
        return 'JP'
    }
    if (resource.language === 'kor') {
        return 'KR'
    }
    if (resource.script === 'Hans') {
        return 'SC'
    }
    if (resource.script === 'Hant') {
        return resource.region === 'HK' ? 'HK' : 'TC'
    }
    return undefined
}


// Resolves user Blueprints into TypstRequests, fetching + caching Bible content as needed
export class BibleContent {

    private client:FetchClient|null
    private _collection:BibleCollection|null
    private patterns:Record<string, string>
    private endpoint:string
    private on_progress?:ProgressFn
    private manifest_ttl_ms:number|null
    // When the collection was last fetched (0 = never), for manifest_ttl_ms staleness checks
    private manifest_fetched = 0
    // Cache of fetched Typst books, keyed `${bible}_${book}` (LRU, shared budget with notes —
    // notes files are small in practice so books dominate the cap)
    private books_typst:LruCache<BibleBookTypst>
    // Cache of fetched plain-text books, keyed `${bible}_${book}` (used by picture stories, which
    // want clean prose with no verse numbers/headings/footnotes — the txt format has none)
    private books_txt:LruCache<BibleBookTxt>
    // Cache of fetched study notes files, keyed `${resource}_${book}` (null = none available)
    private notes_cache:LruCache<TypstNotesFile|null>

    constructor(opts:BibleContentOptions = {}) {
        this._collection = opts.collection ?? null
        this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT
        // remember_fetches disabled — books_typst/notes_cache already cache (and bound) the
        // parsed content, so fetch-client's own raw-text cache would just grow unbounded on
        // top of it for no benefit while entries are live, and defeat cache_max_bytes once
        // they're evicted
        this.client = this._collection
            ? null
            : new FetchClient({endpoints: [this.endpoint], remember_fetches: false})
        this.patterns = opts.patterns ?? PATTERNS
        this.on_progress = opts.on_progress
        this.manifest_ttl_ms = opts.manifest_ttl_ms ?? null
        const cache_ttl_ms = opts.cache_ttl_ms ?? null
        this.books_typst = new LruCache(opts.cache_max_bytes ?? null, cache_ttl_ms)
        this.books_txt = new LruCache(opts.cache_max_bytes ?? null, cache_ttl_ms)
        this.notes_cache = new LruCache(opts.cache_max_bytes ?? null, cache_ttl_ms)
    }

    // Fetch the Bible collection. Must be awaited before use, and is cheap to re-await: it
    // no-ops unless the collection is missing or older than manifest_ttl_ms (long-lived
    // servers re-init per compile to pick up newly published translations eventually)
    async init():Promise<void> {
        if (!this.client) {
            // Collection was injected by the caller — nothing to fetch or refresh
            return
        }
        const stale = this.manifest_ttl_ms !== null
            && Date.now() - this.manifest_fetched > this.manifest_ttl_ms
        if (!this._collection || stale) {
            this._collection = (await this.client.fetch_collection()).bibles
            this.manifest_fetched = Date.now()
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
    // is unavailable in that translation. on_fetch, if given, is called (with the book's display
    // name) instead of the instance's own on_progress, letting resolve() report i/total context
    // that this method alone doesn't have
    async fetch_book(
        bible:string, book:string, on_fetch?:(label:string) => void,
    ):Promise<BibleBookTypst|null> {
        const key = `${bible}_${book}`
        const cached = this.books_typst.get(key)
        if (cached) {
            return cached
        }
        const meta = this.collection.get_books(bible, {object: true})[book]
        if (!meta?.available) {
            return null
        }
        if (on_fetch) {
            on_fetch(meta.name)
        } else {
            this.on_progress?.({stage: 'fetch', label: meta.name})
        }
        const instance = await this.collection.fetch_book(bible, book, 'typst')
        this.books_typst.set(key, instance, estimate_bytes(instance))
        return instance
    }

    // Fetch (and cache) the plain-text content for one book, or null if unavailable. Used by
    // picture stories, which render clean prose rather than the marked-up Typst format
    async fetch_book_txt(
        bible:string, book:string, on_fetch?:(label:string) => void,
    ):Promise<BibleBookTxt|null> {
        const key = `${bible}_${book}`
        const cached = this.books_txt.get(key)
        if (cached) {
            return cached
        }
        const meta = this.collection.get_books(bible, {object: true})[book]
        if (!meta?.available) {
            return null
        }
        if (on_fetch) {
            on_fetch(meta.name)
        } else {
            this.on_progress?.({stage: 'fetch', label: meta.name})
        }
        const instance = await this.collection.fetch_book(bible, book, 'txt')
        this.books_txt.set(key, instance, estimate_bytes(instance))
        return instance
    }

    // Fetch (and cache) a book's study notes file for the given resource (e.g. 'eng_tyndale'),
    // or null if unavailable. Never throws — a missing/unreachable notes file just means no
    // notes for that book, not a broken PDF
    async fetch_notes(resource:string, book:string):Promise<TypstNotesFile|null> {
        const key = `${resource}_${book}`
        if (this.notes_cache.has(key)) {
            return this.notes_cache.get(key)!
        }
        let result:TypstNotesFile|null = null
        try {
            const res = await fetch(`${this.endpoint}notes/${resource}/typst/${book}.json`)
            if (res.ok) {
                result = await res.json() as TypstNotesFile
            }
        } catch {
            // Network/parse failure — degrade gracefully (no notes) but don't cache the miss,
            // so a later resolve on a long-lived instance can retry
            return null
        }
        this.notes_cache.set(key, result, estimate_bytes(result))
        return result
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

    // Resolve a Blueprint into a fully-resolved TypstRequest, fetching any missing content.
    // custom_font_styles is a family -> style lookup for the caller's custom (user-uploaded)
    // fonts, which aren't in the curated typst-fonts manifest so their style can't otherwise be
    // detected — only blue.font_text's entry (if any) is actually used, since font_fallbacks
    // detection is keyed off the body font's style. on_progress overrides the instance's own (set
    // via the constructor), letting a single shared BibleContent report progress per-call rather
    // than only for whichever callback it was constructed with. share_url is this document's
    // production design/version URL, woven into any auto-copyright block as a link + QR code when
    // the blueprint opts in (blue.design_link). page_count is the caller's best current estimate
    // of the finished document length, used only when blue.margin_gutter_auto is on to size the
    // binding gutter added to the inner margin (a thicker book needs a deeper gutter); it falls
    // back to a mid-range guess when the caller has nothing better (e.g. the server fallback)
    async resolve(
        blue:Blueprint, custom_font_styles?:Record<string, FontStyle>, on_progress?:ProgressFn,
        share_url?:string, page_count?:number,
    ):Promise<TypstRequest> {
        const progress = on_progress ?? this.on_progress
        progress?.({stage: 'start'})

        // License metadata for the copyright statement (computed once, shared by custom pages)
        const resources = this.collection.get_resources({object: true})

        // Distinct bible+book pairs the content needs that aren't already cached, so fetch
        // progress can report "downloading N of M" rather than just a bare book name
        const fetch_keys = new Set<string>()
        for (const item of blue.content) {
            if (item.type === 'passage') {
                for (const bible of blue.bibles) {
                    fetch_keys.add(`${bible}_${item.book}`)
                }
            } else if (item.type === 'picture_story') {
                // Each passage slide fetches its book from the primary translation, plus the
                // second one (when selected) for the stacked second-translation body
                for (const slide of item.slides) {
                    if (slide.mode === 'passage' && slide.book) {
                        fetch_keys.add(`${blue.bibles[0]}_${slide.book}`)
                        if (blue.bibles[1]) {
                            fetch_keys.add(`${blue.bibles[1]}_${slide.book}`)
                        }
                    }
                }
            }
        }
        const fetch_total = [...fetch_keys].filter(key => !this.books_typst.has(key)).length
        let fetch_i = 0
        const report_fetch = (label:string) => {
            fetch_i += 1
            progress?.({stage: 'fetch', i: fetch_i, total: fetch_total, label})
        }

        // Resolve the global title-page style config once, and the icon color it needs (icon
        // recoloring happens once per icon below, ahead of the request-level config)
        const titlepage_color_icon = blue.titlepage_color_icon ?? '#000000'

        // Map supported content items (study notes/crossrefs are not yet supported, skipped)
        const items:TypstContentItem[] = []
        for (const item of blue.content) {
            if (item.type === 'passage') {
                // A passage's own title, auto-shown as a full title page immediately before it
                // when the document-wide passage_title setting is set to 'titlepage'
                if (blue.passage_title === 'titlepage' && item.title.trim()) {
                    items.push(await this.gen_title_page(item, titlepage_color_icon))
                }
                items.push(await this.gen_passage_item(blue, item, report_fetch))
            } else if (item.type === 'title') {
                items.push(await this.gen_title_page(item, titlepage_color_icon))
            } else if (item.type === 'custom') {
                items.push(this.gen_custom_item(blue, item, resources, share_url))
            } else if (item.type === 'picture_story') {
                // Auto title page before the story, same rule as passages
                if (blue.passage_title === 'titlepage' && item.title.trim()) {
                    items.push(await this.gen_title_page(item, titlepage_color_icon))
                }
                items.push(await this.gen_picture_story_item(blue, item, report_fetch))
            }
        }

        const font_text2 = blue.font_text2 ?? blue.font_text
        // font_size2 is a multiple of the primary text size (1 = match)
        const font_size2 = blue.font_size * blue.font_size2

        // Collect every resolved passage image's bytes into one asset map, keyed by the virtual
        // filename generated Typst source references (see gen_passage_image in content_passage.ts)
        const assets:Record<string, Uint8Array> = {}
        for (const item of items) {
            if (item.type === 'passage' && item.image) {
                assets[item.image.filename] = item.image.bytes
            } else if (item.type === 'picture_story') {
                for (const slide of item.slides) {
                    if (slide.image) {
                        assets[slide.image.filename] = slide.image.bytes
                    }
                }
            }
        }

        return {
            title: blue.title,
            page: this.gen_page(blue, page_count),
            typography: {
                font_text: blue.font_text,
                font_text2,
                font_headings: blue.font_headings ?? blue.font_text,
                font_headings2: blue.font_headings ?? font_text2,
                font_fallbacks: detect_font_fallbacks(
                    items, blue.font_text, custom_font_styles?.[blue.font_text], 0,
                    resolve_declared_cjk_variant(resources[blue.bibles[0]])),
                font_fallbacks2: detect_font_fallbacks(
                    items, font_text2, custom_font_styles?.[font_text2], 1,
                    blue.bibles[1] ? resolve_declared_cjk_variant(resources[blue.bibles[1]])
                        : undefined),
                font_size: `${blue.font_size}pt`,
                font_size2: `${font_size2}pt`,
                line_height: blue.line_height,
                justify: blue.justify,
                hyphenate: blue.hyphenate,
                poetry_outdent: blue.poetry_outdent,
                text_color: blue.text_color,
            },
            titlepage: this.gen_titlepage_config(blue),
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
            running_pages: blue.running_pages,
            running_headings: blue.running_headings,
            running_position: blue.running_position,
            running_align: blue.running_align,
            booklet_portrait: blue.booklet_portrait,
            image_style: blue.image_style,
            story_layout: blue.story_layout,
            story_alternate: blue.story_alternate,
            assets,
        }
    }

    // Resolve the chosen trim size + margins to a concrete PageConfig of Typst unit strings.
    // page_count is only consulted for the auto binding-gutter (margin_gutter_auto); a
    // plausible mid-size book is assumed when the caller has no estimate to offer
    private gen_page(blue:Blueprint, page_count=300):PageConfig {
        let trim = resolve_trim(blue)

        // Booklet: the chosen size is the sheet that gets folded in half, so each reading page
        // is half of it. Fold across the sheet's longer axis and rotate the result upright —
        // an A4 sheet yields A5 reading pages, US Letter yields half-Letter. apply_booklet()
        // (pdf_postprocess.ts) then places two of these side by side to rebuild the full sheet
        if (blue.booklet) {
            const longer = Math.max(trim.width, trim.height)
            const shorter = Math.min(trim.width, trim.height)
            trim = {width: longer / 2, height: shorter, unit: trim.unit}
        }

        // Clamp each margin to 50% of the corresponding trim dimension (in the margin's own
        // unit, since trim/margin units can differ) so a bad/extreme value can't collapse or
        // invert the content area and blow up layout/compile
        const max_vertical = convert_unit(trim.height, trim.unit, blue.margin_unit) / 2
        const max_horizontal = convert_unit(trim.width, trim.unit, blue.margin_unit) / 2

        // Optionally deepen the inner margin by the printing service's calculated binding gutter
        // so text near the spine isn't lost into the fold (no-op for home/booklet/custom modes)
        const gutter = blue.margin_gutter_auto ? resolve_binding_gutter(blue, page_count) : 0

        const margin_top = Math.min(blue.margin_top, max_vertical)
        const margin_bottom = Math.min(blue.margin_bottom, max_vertical)
        const margin_inner = Math.min(blue.margin_inner + gutter, max_horizontal)
        const margin_outer = Math.min(blue.margin_outer, max_horizontal)

        return {
            // Reading-page size (already halved above for booklets); the 2-up sheet is
            // reassembled in apply_booklet()
            width: `${trim.width}${trim.unit}`,
            height: `${trim.height}${trim.unit}`,
            margin_top: `${margin_top}${blue.margin_unit}`,
            margin_bottom: `${margin_bottom}${blue.margin_unit}`,
            // Inner/outer map to typst's inside/outside binding-aware margins
            margin_left: `${margin_inner}${blue.margin_unit}`,
            margin_right: `${margin_outer}${blue.margin_unit}`,
        }
    }

    // Build the resolved Typst content for each translation of a passage
    private async gen_passage_bibles(
        blue:Blueprint, passage:ContentPassage, report_fetch?:(label:string) => void,
    ):Promise<BiblePassageData[]> {
        const ref = new PassageReference(passage)
        const bibles:BiblePassageData[] = []

        // Collect content for each selected translation that has this book available
        for (const bible of blue.bibles) {
            const instance = await this.fetch_book(bible, passage.book, report_fetch)
            if (!instance) {
                continue
            }
            bibles.push({content: instance.get_passage_from_ref(ref, {attribute: false})})
        }

        // Guarantee at least one entry so the renderer always has content to work with
        if (!bibles.length) {
            bibles.push({content: ''})
        }

        // Splice study notes into the primary translation only — footnotes render once per page
        // regardless of column/alternate layout, so injecting into a second translation too
        // would duplicate every note
        if (blue.notes) {
            const notes_file = await this.fetch_notes(blue.notes, passage.book)
            if (notes_file) {
                bibles[0]!.content = inject_study_notes(bibles[0]!.content, notes_file, ref)
            }
        }

        return bibles
    }

    // Convert a passage content item to its Typst equivalent
    private async gen_passage_item(
        blue:Blueprint, passage:ContentPassage, report_fetch?:(label:string) => void,
    ):Promise<TypstPassage> {
        // Computed once regardless of passage_title mode, since progress_label always needs it
        const reference = this.collection.reference_to_string(
            new PassageReference(passage), blue.bibles[0])
        // Inline heading mode only — 'titlepage' mode is handled by injecting a separate
        // synthetic TypstTitlePage item before this one (see resolve())
        const show_heading = blue.passage_title === 'heading' && passage.title.trim() !== ''
        const image = passage.image
            ? await resolve_passage_image(passage.image, passage.id)
            : null
        return {
            type: 'passage',
            bibles: await this.gen_passage_bibles(blue, passage, report_fetch),
            image,
            multi_layout: blue.bibles_layout,
            multi_align: blue.bibles_align,
            half_blank: blue.half_blank,
            show_headings: blue.show_headings,
            headings_bold: blue.show_headings_bold,
            headings_italic: blue.show_headings_italic,
            headings_size: blue.show_headings_size,
            // Regular translator footnotes are disabled while study notes are on
            show_footnotes: blue.notes ? false : blue.show_footnotes,
            show_lines: blue.show_lines,
            // null = auto-detect by book, true = 2 columns, false = single column
            columns: blue.columns === null ? 'auto' : (blue.columns ? 2 : 1),
            column_gap: `${blue.column_gap}${blue.margin_unit}`,
            book: passage.book,
            book_name: this.collection.get_books(blue.bibles[0], {object: true})[passage.book]
                ?.name ?? passage.book,
            start_chapter: passage.start_chapter ?? 1,
            passage_title: show_heading ? passage.title : null,
            passage_subtitle: show_heading && passage.title_subtitle ? passage.title_subtitle : null,
            progress_label: reference,
        }
    }

    // Convert a picture-story content item to its Typst equivalent. A passage slide renders clean
    // prose from the plain-text format (no verse numbers/headings/footnotes); when a second bible
    // is selected, the same passage in that translation is also resolved (body2), stacked below
    // the first (see gen_picture_story). A text slide is prose-converted from its rich-text doc
    // and never has a second body (it's free text, not tied to a translation). When
    // blue.story_emphasis is on, passage prose auto-italicizes questions and emboldens
    // exclamations (enlarged + colored per blue.story_emphasis_color). Layout (single/grid) and
    // image-side alternation are decided at generate time,
    // not here — see gen_picture_story in content_picture_story.ts
    private async gen_picture_story_item(
        blue:Blueprint, story:ContentPictureStory, report_fetch?:(label:string) => void,
    ):Promise<TypstPictureStory> {
        const slides:TypstPictureStorySlide[] = []
        // Carried across slides (one array per translation, mutated in place by
        // emphasize_sentences) so dialogue split across slides — e.g. one slide per verse — is
        // still recognized as a quote once it resumes on a later slide that never itself opens one
        const quote_state:QuoteState = []
        const quote_state2:QuoteState = []
        for (const [i, slide] of story.slides.entries()) {
            // Image bytes, keyed per slide so virtual filenames never collide
            const image = slide.image
                ? await resolve_passage_image(slide.image, `${story.id}_${i}`)
                : null

            let body:string|null = null
            let body2:string|null = null
            if (slide.mode === 'passage' && slide.book) {
                const ref = new PassageReference(slide)
                // Clean prose from the primary translation's plain-text format
                const instance = await this.fetch_book_txt(blue.bibles[0], slide.book, report_fetch)
                const text = instance
                    ? instance.get_passage_from_ref(ref, {
                        attribute: false, verse_nums: false, headings: false, notes: false})
                    : ''
                body = blue.story_emphasis
                    ? emphasize_sentences(text, blue.story_emphasis_color, quote_state)
                    : escape_typst(text)

                // Second translation (when selected), same passage, rendered below the first
                if (blue.bibles[1]) {
                    const instance2 =
                        await this.fetch_book_txt(blue.bibles[1], slide.book, report_fetch)
                    const text2 = instance2
                        ? instance2.get_passage_from_ref(ref, {
                            attribute: false, verse_nums: false, headings: false, notes: false})
                        : ''
                    body2 = blue.story_emphasis
                        ? emphasize_sentences(text2, blue.story_emphasis_color, quote_state2)
                        : escape_typst(text2)
                }
            } else if (slide.mode === 'text') {
                body = prose_to_typst(slide.doc)
            }

            slides.push({image, body, body2})
        }
        return {type: 'picture_story', slides}
    }

    // Resolve the document-wide title-page style config (shared by every title page: standalone
    // ContentTitle items and passages auto-showing a title page alike)
    private gen_titlepage_config(blue:Blueprint):TitlepageConfig {
        return {
            font: blue.titlepage_font ?? blue.font_text,
            frame_svg: blue.titlepage_frame ? (this.patterns[blue.titlepage_frame] ?? null) : null,
            color_text: blue.titlepage_color_text ?? '#000000',
            color_frame: blue.titlepage_color_frame ?? '#000000',
            text_size: blue.titlepage_text_size,
            icon_size: blue.titlepage_icon_size,
            always: blue.titlepage_always,
        }
    }

    // Build a TypstTitlePage from anything with title/title_subtitle/title_icon — used both for
    // standalone ContentTitle items and the synthetic title page auto-inserted before a passage
    // when blue.passage_title === 'titlepage' (see resolve())
    private async gen_title_page(
        source:{title:string, title_subtitle:string, title_icon:string|null},
        color_icon:string,
    ):Promise<TypstTitlePage> {
        // Resolve the Iconify ID (or raw SVG) to a recolored SVG; ignore a failed fetch so a bad
        // icon ID never breaks the whole document (the title just renders without an icon)
        let icon:string|null = null
        if (source.title_icon) {
            try {
                icon = await resolve_icon(source.title_icon, color_icon)
            } catch {
                icon = null
            }
        }

        return {
            type: 'title',
            title: source.title,
            subtitle: source.title_subtitle,
            icon,
        }
    }

    // Convert a custom (rich text) content item to its Typst equivalent
    private gen_custom_item(
        blue:Blueprint, custom:ContentCustom, resources:Record<string, GetResourcesItem>,
        share_url?:string,
    ):TypstCustomPage {
        let markup = prose_to_typst(custom.doc)

        // Replace the AUTO-COPYRIGHT marker with the generated copyright block
        markup = replace_copyright_marker(markup, gen_copyright_typst(blue, resources, share_url))

        // Position is applied by the renderer (top/middle/bottom of the page)
        return {
            type: 'custom',
            content: markup,
            position: custom.position,
        }
    }
}
