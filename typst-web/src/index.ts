
import {createTypstCompiler, CompileFormatEnum} from '@myriaddreamin/typst.ts/compiler'
import {createTypstRenderer} from '@myriaddreamin/typst.ts/renderer'
import {loadFonts} from '@myriaddreamin/typst.ts'

import {load_fonts_prefix, font_urls_for, fonts_to_blob_urls, revoke_blob_urls} from 'typst-fonts/web'

import {generate_pdf, generate_svg_preview, split_typst_svg, generate_typst, collect_fonts}
    from 'paper-bible-typst'

import type {TypstCompiler} from '@myriaddreamin/typst.ts/compiler'
import type {TypstRenderer} from '@myriaddreamin/typst.ts/renderer'
import type {CustomFont} from 'typst-fonts'
import type {TypstRequest, CompileFn, ProgressFn, SvgPage, SvgCompileFn} from 'paper-bible-typst'


// Asset subdirectory name for fonts (under a consumer-provided assets prefix), matching
// the assets tree published by the bookcover repo
const FONTS_DIR = 'fonts'

// Compiled-source budget per realm (see TypstWeb.worn). At ~60x permanent growth per unique
// source byte, 16MB of source keeps the WASM heap around 1GB — well clear of the 4GB 32-bit
// ceiling while still only recycling after several full-Bible-sized compiles
const COMPILE_BYTES_BUDGET = 16 * 1024 * 1024


// Options for initialising the in-browser Typst compiler
export interface InitOptions {
    // URL to the typst_ts_web_compiler_bg.wasm module (required)
    wasm_url:string
    // URL prefix under which bundled fonts are served (default '/generator_assets/').
    // Font files are fetched from `${assets_prefix}/fonts/<family>/<file>.ttf`.
    assets_prefix?:string
    // URL to the typst_ts_renderer_bg.wasm module — only needed for SVG output (compile_svg(),
    // compile_svg_preview()), and only fetched the first time one is asked for (see
    // ensure_renderer)
    renderer_wasm_url?:string
}


// Simple 32-bit string hash (djb2), fast enough for multi-MB sources (see seen_sources)
function hash_source(source:string):number {
    let hash = 5381
    for (let i = 0; i < source.length; i++) {
        hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0
    }
    return hash
}


// Format compilation diagnostics into a readable error
function throw_compile_error(diagnostics:unknown):never {
    const diag = Array.isArray(diagnostics)
        ? diagnostics.map(d => typeof d === 'string' ? d : JSON.stringify(d)).join('\n')
        : 'unknown error'
    throw new Error(`[typst-web] Typst compilation failed:\n${diag}`)
}


// Stateful in-browser Typst compiler. Owns a WASM compiler instance and reinitialises it
// with the appropriate fonts whenever the set of fonts a request needs changes.
export class TypstWeb {
    private wasm_url:string
    private renderer_wasm_url:string|null
    private fonts_prefix:string
    private compiler:TypstCompiler
    // Created on the first SVG compile only (SVG output is preview-only — see ensure_renderer)
    private renderer:TypstRenderer|null = null
    // Comma-joined font families (+ custom font names) last used to init the compiler
    // ('' = base fonts only)
    private active_fonts = ''
    // Blob URLs created for the currently-active custom fonts, tracked so they can be revoked
    // once superseded (see ensure_fonts)
    private active_blob_urls:string[] = []
    // Resolves once the curated font manifest has been fetched (see typst-fonts/web); null after
    // a failed fetch, so the next compile retries it (see manifest_ready)
    private fonts_manifest_ready:Promise<void>|null
    // User-uploaded fonts, not in the curated manifest — set via set_custom_fonts(). Read fresh
    // each ensure_fonts() call, so a caller can keep passing the same (mutated) array reference
    // rather than re-calling the setter on every upload
    private custom_fonts:CustomFont[] = []
    // Cumulative Typst source bytes compiled in this realm. The WASM compiler permanently
    // accumulates module-global state for every unique source it compiles (measured at roughly
    // 60x the source size): the wasm-bindgen module is a once-per-realm singleton, so no
    // reset()/evict or even createTypstCompiler() ever frees it, and the 32-bit WASM heap
    // never shrinks. Only discarding the whole realm reclaims it — see worn below.
    private compiled_bytes = 0
    // Hashes of every unique source compiled in this realm — an exact repeat (e.g. an unchanged
    // preview recompile) hits the compiler's caches and adds no lasting memory, so only unseen
    // sources count toward the budget above
    private seen_sources = new Set<number>()

    constructor(wasm_url:string, assets_prefix:string, compiler:TypstCompiler,
            renderer_wasm_url:string|null = null) {
        this.wasm_url = wasm_url
        this.renderer_wasm_url = renderer_wasm_url
        this.fonts_prefix = `${assets_prefix.replace(/\/+$/, '')}/${FONTS_DIR}`
        this.compiler = compiler
        this.fonts_manifest_ready = this.load_manifest()
    }

    // Fetch the curated font manifest, forgetting the attempt if it fails — otherwise one network
    // blip as the worker starts would fail every compile for the rest of the session
    private load_manifest():Promise<void> {
        const loading = load_fonts_prefix(this.fonts_prefix)
        loading.catch(() => {
            if (this.fonts_manifest_ready === loading) {
                this.fonts_manifest_ready = null
            }
        })
        return loading
    }

    // The manifest fetch in progress or done, starting a fresh one after a failure
    private manifest_ready():Promise<void> {
        this.fonts_manifest_ready ??= this.load_manifest()
        return this.fonts_manifest_ready
    }

    // Register the caller's custom (user-uploaded) fonts, made available to future compiles
    set_custom_fonts(fonts:CustomFont[]):void {
        this.custom_fonts = fonts
        // Force ensure_fonts() to re-evaluate on the next compile, in case this changes what's
        // needed even though `fonts` may be the same array reference as before (mutated in place)
        this.active_fonts = ''
    }

    // A new compiler instance that can shape text with the given font URLs
    private async create_compiler(font_urls:string[]):Promise<TypstCompiler> {
        const compiler = createTypstCompiler()
        await compiler.init({
            getModule: () => ({module_or_path: this.wasm_url}),
            beforeBuild: [loadFonts(font_urls, {assets: false})],
        })
        return compiler
    }

    // (Re)initialise the compiler so it can shape text with the given font URLs
    private async reinit_compiler(font_urls:string[]):Promise<void> {
        this.compiler = await this.create_compiler(font_urls)
    }

    // Whether this realm has accumulated enough permanent WASM state (see compiled_bytes) that
    // the host should recycle it — i.e. terminate and respawn the hosting Web Worker — before
    // an allocation eventually fails and the compiler aborts ("RuntimeError: unreachable")
    get worn():boolean {
        return this.compiled_bytes > COMPILE_BYTES_BUDGET
    }

    // Create the renderer WASM instance on first use — SVG output is a preview-only extra, so
    // its module is never fetched for a host that only ever compiles PDFs
    private async ensure_renderer():Promise<TypstRenderer> {
        if (this.renderer) {
            return this.renderer
        }
        if (!this.renderer_wasm_url) {
            throw new Error('[typst-web] SVG output requires renderer_wasm_url in init() options')
        }
        const renderer = createTypstRenderer()
        // Base fonts only — glyph shapes are embedded in the compiled vector data
        await renderer.init({
            getModule: () => ({module_or_path: this.renderer_wasm_url!}),
            beforeBuild: [loadFonts([])],
        })
        this.renderer = renderer
        return renderer
    }

    // Count a source's bytes toward the wear budget above, unless this exact source was seen
    private count_wear(source:string):void {
        const hash = hash_source(source)
        if (!this.seen_sources.has(hash)) {
            this.seen_sources.add(hash)
            this.compiled_bytes += source.length
        }
    }

    // Register one source (plus any assets) in the compiler's shadow filesystem, counting its
    // bytes toward the wear budget above. assets (e.g. passage images) are mapped by virtual
    // filename, the same primitive the bookcover-web pipeline uses for its own images
    private load_source(source:string, assets?:Record<string, Uint8Array>):void {
        this.count_wear(source)
        this.compiler.resetShadow()
        this.compiler.addSource('/main.typ', source)
        for (const [filename, bytes] of Object.entries(assets ?? {})) {
            this.compiler.mapShadow(`/${filename}`, bytes)
        }
    }

    // Build a compile function that turns a single Typst source string into PDF bytes
    private make_compile_fn():CompileFn {
        return async (source:string, assets?:Record<string, Uint8Array>):Promise<Uint8Array> => {
            this.load_source(source, assets)
            const result = await this.compiler.compile({
                mainFilePath: '/main.typ',
                format: CompileFormatEnum.pdf,
            })
            if (!result.result) {
                throw_compile_error(result.diagnostics)
            }
            return result.result
        }
    }

    // Build a compile function that turns a single Typst source string into its pages as SVG
    private make_svg_compile_fn(renderer:TypstRenderer):SvgCompileFn {
        return async (source:string, assets?:Record<string, Uint8Array>):Promise<SvgPage[]> => {
            this.load_source(source, assets)
            const result = await this.compiler.compile({
                mainFilePath: '/main.typ',
                format: CompileFormatEnum.vector,
            })
            if (!result.result) {
                throw_compile_error(result.diagnostics)
            }
            return split_typst_svg(await renderer.renderSvg({
                artifactContent: result.result,
                format: 'vector',
                data_selection: {js: false, css: false, body: true, defs: true},
            }))
        }
    }

    // Reinitialise the compiler only when the set of fonts a request needs changes
    private async ensure_fonts(request:TypstRequest):Promise<void> {
        await this.manifest_ready()
        const families = collect_fonts(request)
        const custom_by_family = new Map(this.custom_fonts.map(f => [f.family, f]))
        const cache_key = families.join(',') + '|' + [...custom_by_family.keys()].join(',')
        if (cache_key === this.active_fonts) {
            return
        }

        // Build a flat list of font file URLs for every non-custom family the request uses
        // (curated fonts and Noto per-script fallbacks alike) — a family matching a custom font
        // is excluded here, resolved from bytes below instead, so custom always wins on a
        // same-named collision
        const bundled_families = families.filter(f => !custom_by_family.has(f))
        const font_urls = font_urls_for(this.fonts_prefix, bundled_families)

        // Custom fonts have no URL — turn the bytes of whichever ones this request actually
        // needs into blob URLs instead
        const needed_custom = families
            .map(f => custom_by_family.get(f))
            .filter((f):f is CustomFont => f !== undefined)
        const new_blob_urls = fonts_to_blob_urls(needed_custom.flatMap(f => f.files))

        try {
            await this.reinit_compiler([...font_urls, ...new_blob_urls])
        } catch (err) {
            // Reinit failed — don't leak this attempt's blob URLs, and leave active_fonts/
            // active_blob_urls untouched so the next call retries cleanly instead of treating
            // the failed attempt's URLs as "previous" and never revoking them
            revoke_blob_urls(new_blob_urls)
            throw err
        }

        // Success — now safe to revoke the previous generation's blob URLs
        revoke_blob_urls(this.active_blob_urls)
        this.active_blob_urls = new_blob_urls
        this.active_fonts = cache_key
    }

    // Compile a request to a finished PDF (handles booklet/alternate/half-blank via pdf-lib).
    // preview relaxes print-only padding (trailing blanks dropped, even page counts only) for
    // on-screen display — never use it for a document that will be printed.
    async compile_pdf(
        request:TypstRequest, on_progress?:ProgressFn, preview = false,
    ):Promise<Uint8Array> {
        await this.ensure_fonts(request)
        return generate_pdf(request, this.make_compile_fn(), on_progress, preview)
    }

    // Compile a request to its pages in reading order, one standalone SVG each, for the preview
    // (see generate_svg_preview) — the same pages print assembles, without the PDF
    async compile_svg_preview(request:TypstRequest, on_progress?:ProgressFn):Promise<SvgPage[]> {
        const renderer = await this.ensure_renderer()
        await this.ensure_fonts(request)
        return generate_svg_preview(request, this.make_svg_compile_fn(renderer), on_progress)
    }

    // Compile a request straight to an SVG string, skipping the PDF post-processing pipeline
    // (no booklet imposition, no blank padding) — so this is for single-page requests shown
    // on screen as an image, such as the wizard's minimal-ink cover card, not for printing
    async compile_svg(request:TypstRequest):Promise<string> {
        const renderer = await this.ensure_renderer()
        await this.ensure_fonts(request)
        this.load_source(generate_typst(request), request.assets)
        const result = await this.compiler.compile({
            mainFilePath: '/main.typ',
            format: CompileFormatEnum.vector,
        })
        if (!result.result) {
            throw_compile_error(result.diagnostics)
        }
        const svg = await renderer.renderSvg({
            artifactContent: result.result,
            format: 'vector',
            data_selection: {js: false, css: true, body: true, defs: true},
        })
        // Typst's SVG output sizes in pt but writes the numbers unitless — add the suffix back
        // so browsers lay the image out at 96 CSS px per inch rather than 1px per pt
        return svg.replace(/<svg([^>]*)>/, (_match:string, attrs:string) => {
            const patched = attrs
                .replace(/width="([\d.]+)"/, 'width="$1pt"')
                .replace(/height="([\d.]+)"/, 'height="$1pt"')
            return `<svg${patched}>`
        })
    }
}


// Create a TypstWeb instance with an initialised WASM compiler (base fonts only — fonts are
// (re)loaded per compile_pdf() call based on what each request needs).
export async function init(options:InitOptions):Promise<TypstWeb> {
    const assets_prefix = options.assets_prefix ?? '/generator_assets/'

    const compiler = createTypstCompiler()
    await compiler.init({
        getModule: () => ({module_or_path: options.wasm_url}),
        beforeBuild: [loadFonts([], {assets: false})],
    })

    return new TypstWeb(options.wasm_url, assets_prefix, compiler,
        options.renderer_wasm_url ?? null)
}
