
import {createTypstCompiler, CompileFormatEnum} from '@myriaddreamin/typst.ts/compiler'
import {loadFonts} from '@myriaddreamin/typst.ts'

import {generate_pdf, generate_pdf_spread_preview, collect_fonts,
    get_bundled_font, asset_path, FONTS_DIR} from 'paper-bible-typst'

import type {TypstCompiler} from '@myriaddreamin/typst.ts/compiler'
import type {TypstRequest, CompileFn} from 'paper-bible-typst'


// Options for initialising the in-browser Typst compiler
export interface InitOptions {
    // URL to the typst_ts_web_compiler_bg.wasm module (required)
    wasm_url:string
    // URL prefix under which bundled fonts are served (default '/generator_assets/').
    // Font files are fetched from `${assets_prefix}/fonts/<family>/<file>.ttf`.
    assets_prefix?:string
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
    private assets_prefix:string
    private compiler:TypstCompiler
    // Comma-joined font families last used to init the compiler ('' = base fonts only)
    private active_fonts = ''

    constructor(wasm_url:string, assets_prefix:string, compiler:TypstCompiler) {
        this.wasm_url = wasm_url
        this.assets_prefix = assets_prefix
        this.compiler = compiler
    }

    // (Re)initialise the compiler so it can shape text with the given font URLs
    private async reinit_compiler(font_urls:string[]):Promise<void> {
        const compiler = createTypstCompiler()
        await compiler.init({
            getModule: () => ({module_or_path: this.wasm_url}),
            beforeBuild: [loadFonts(font_urls)],
        })
        this.compiler = compiler
    }

    // Build a compile function that turns a single Typst source string into PDF bytes
    private make_compile_fn():CompileFn {
        return async (source:string):Promise<Uint8Array> => {
            // Log the full Typst document to the console before rendering
            console.log(source)
            this.compiler.resetShadow()
            this.compiler.addSource('/main.typ', source)
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

    // Reinitialise the compiler only when the set of fonts a request needs changes
    private async ensure_fonts(request:TypstRequest):Promise<void> {
        const families = collect_fonts(request)
        const cache_key = families.join(',')
        if (cache_key === this.active_fonts) {
            return
        }
        // Build a flat list of font file URLs for every family the request uses
        const font_urls:string[] = []
        for (const family of families) {
            const bundled = get_bundled_font(family)
            if (!bundled) {
                continue
            }
            for (const file of bundled.files) {
                font_urls.push(asset_path(this.assets_prefix, FONTS_DIR,
                    encodeURIComponent(family), encodeURIComponent(file)))
            }
        }
        await this.reinit_compiler(font_urls)
        this.active_fonts = cache_key
    }

    // Compile a request to a finished PDF (handles booklet/alternate/half-blank via pdf-lib)
    async compile_pdf(request:TypstRequest):Promise<Uint8Array> {
        await this.ensure_fonts(request)
        return generate_pdf(request, this.make_compile_fn())
    }

    // Compile a request to a preview PDF laid out as facing-page book spreads, as if the
    // book were opened: a blank left page beside page 1 on the right, then 2|3, 4|5, etc.,
    // including every blank/note page exactly as printed. For on-screen preview only.
    async compile_pdf_preview(request:TypstRequest):Promise<Uint8Array> {
        await this.ensure_fonts(request)
        return generate_pdf_spread_preview(request, this.make_compile_fn())
    }
}


// Create a TypstWeb instance with an initialised WASM compiler (base fonts only — fonts are
// (re)loaded per compile_pdf() call based on what each request needs).
export async function init(options:InitOptions):Promise<TypstWeb> {
    const assets_prefix = options.assets_prefix ?? '/generator_assets/'

    const compiler = createTypstCompiler()
    await compiler.init({
        getModule: () => ({module_or_path: options.wasm_url}),
        beforeBuild: [loadFonts([])],
    })

    return new TypstWeb(options.wasm_url, assets_prefix, compiler)
}
