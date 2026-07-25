
import {execFile} from 'node:child_process'
import {writeFile, readFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {load_fonts_dir, resolve_font_dirs, write_custom_fonts} from 'typst-fonts/node'

import {generate_typst, generate_pdf, generate_pdf_spread_preview, BibleContent, collect_fonts,
    } from 'paper-bible-typst'

import type {CustomFont} from 'typst-fonts'
import type {TypstRequest, CompileFn, ProgressFn, Blueprint} from 'paper-bible-typst'


// Options for the Node.js Typst compiler wrapper
export interface NodeCompileOptions {
    // Path to the typst CLI binary (default: "typst")
    typst_path?:string
    // Directory holding the curated fonts tree (manifest.json + per-family dirs, from the
    // bookcover repo's assets). When set, font directories for the families a request needs
    // are resolved automatically via typst-fonts/node
    fonts_dir?:string
    // Additional font directories to pass to the typst CLI, on top of any resolved from
    // fonts_dir
    font_paths?:string[]
    // User-uploaded fonts (not in the curated manifest) to make available to this compile.
    // Written to a per-compile temp directory and passed via --font-path; a family here always
    // takes precedence over a same-named curated font (see resolve_font_paths)
    custom_fonts?:CustomFont[]
    // Coarse progress reporting (per-book rendering steps, content fetching)
    on_progress?:ProgressFn
}


// Options for compiling straight from a Blueprint (adds Bible-content fetching config)
export interface BlueprintCompileOptions extends NodeCompileOptions {
    // Bible content API endpoint (defaults to production fetch.bible)
    endpoint?:string
    // Title-page decorative patterns, keyed by pattern name → corner SVG string
    patterns?:Record<string, string>
    // Reuse a long-lived BibleContent so its collection + book caches persist across compiles
    // (endpoint/patterns above are ignored when set — they belong to the instance). init() is
    // still awaited each compile, which is a no-op unless the instance's TTL has lapsed
    content?:BibleContent
}


// Compile a TypstRequest to PDF using the official Typst CLI
// Handles the full pipeline: generate → compile → post-process
export async function compile_pdf(
    request:TypstRequest, options?:NodeCompileOptions,
):Promise<Uint8Array> {
    const font_paths = await resolve_font_paths(request, options)
    const compile_fn = make_compile_fn(options, font_paths)
    return generate_pdf(request, compile_fn, options?.on_progress)
}


// Compile a TypstRequest to a preview PDF laid out as facing-page book spreads
export async function compile_pdf_spread_preview(
    request:TypstRequest, options?:NodeCompileOptions,
):Promise<Uint8Array> {
    const font_paths = await resolve_font_paths(request, options)
    const compile_fn = make_compile_fn(options, font_paths)
    return generate_pdf_spread_preview(request, compile_fn, options?.on_progress)
}


// Compile straight from the user's selected options (Blueprint) to a finished PDF: fetches and
// caches the Bible content internally, resolves it to a TypstRequest, then compiles. This is
// the server "hand it the options, get a PDF" path — no separate fetch logic required.
export async function compile_pdf_from_blueprint(
    blueprint:Blueprint, options?:BlueprintCompileOptions,
):Promise<Uint8Array> {
    // Load the curated font manifest before resolving, so BibleContent's script-detection can
    // match Noto fallback style (serif/sans) to the chosen body font (font_style() needs it)
    if (options?.fonts_dir) {
        await load_fonts_dir(options.fonts_dir)
    }
    const content = options?.content ?? new BibleContent({
        endpoint: options?.endpoint,
        patterns: options?.patterns,
    })
    await content.init()
    const custom_font_styles = Object.fromEntries(
        (options?.custom_fonts ?? []).map(f => [f.family, f.style]))
    // on_progress passed per-call (not via the constructor) so a shared instance reports to
    // whichever compile is running
    const request = await content.resolve(blueprint, custom_font_styles, options?.on_progress)
    const font_paths = await resolve_font_paths(request, options)
    return generate_pdf(request, make_compile_fn(options, font_paths), options?.on_progress)
}


// Resolve the on-disk font directories a request needs: auto-resolved from fonts_dir (if
// given) plus any caller-supplied extras. Families matching a custom_fonts entry are excluded
// here — their bytes are resolved separately per-compile in make_compile_fn, and a same-named
// custom font always takes precedence over a curated one
async function resolve_font_paths(
    request:TypstRequest, options?:NodeCompileOptions,
):Promise<string[]> {
    const extra = options?.font_paths ?? []
    if (!options?.fonts_dir) {
        return extra
    }
    await load_fonts_dir(options.fonts_dir)
    const custom_families = new Set((options.custom_fonts ?? []).map(f => f.family))
    const families = collect_fonts(request).filter(f => !custom_families.has(f))
    return [...resolve_font_dirs(options.fonts_dir, families), ...extra]
}


// Re-export the inner function for generating just the Typst source
export {generate_typst} from 'paper-bible-typst'

// Re-export the Bible-content layer so servers can hold a shared instance across compiles
export {BibleContent} from 'paper-bible-typst'
export type {BibleContentOptions} from 'paper-bible-typst'

// Re-export the custom (user-uploaded) font type, needed to build NodeCompileOptions.custom_fonts
export type {CustomFont} from 'typst-fonts'

// Re-export all types
export type {
    TypstRequest, PageConfig, TypographyConfig, TitlepageConfig, TypstContentItem,
    TypstPassage, BiblePassageData, TypstTitlePage, TypstCustomPage,
    TypstLinesPage, CompileFn, ProgressFn, ProgressEvent, ProgressStage,
    Blueprint, ContentItem, ContentTitle, ContentPassage, ContentCustom,
} from 'paper-bible-typst'


// Create a compile function that uses the Typst CLI
function make_compile_fn(options:NodeCompileOptions | undefined, font_paths:string[]):CompileFn {
    const typst_path = options?.typst_path ?? 'typst'

    return async (source:string, assets?:Record<string, Uint8Array>):Promise<Uint8Array> => {
        // Create a temp directory for this compilation
        const tmp_dir = await mkdtemp(join(tmpdir(), 'typst-'))
        const input_path = join(tmp_dir, 'input.typ')
        const output_path = join(tmp_dir, 'output.pdf')

        try {
            // Write the Typst source to a temp file
            await writeFile(input_path, source, 'utf-8')

            // Write any binary assets (e.g. passage images) alongside it, so the CLI resolves
            // image("filename") relative to its own working directory (the same technique the
            // bookcover-node pipeline uses for its own images)
            for (const [filename, bytes] of Object.entries(assets ?? {})) {
                await writeFile(join(tmp_dir, filename), bytes)
            }

            // Write any custom (user-uploaded) fonts into this same temp dir, reusing its
            // existing cleanup below rather than a second temp-directory lifecycle
            const custom_font_paths = options?.custom_fonts?.length
                ? await write_custom_fonts(join(tmp_dir, 'fonts'), options.custom_fonts)
                : []

            // Build CLI arguments
            const args = ['compile', input_path, output_path]
            for (const fp of [...font_paths, ...custom_font_paths]) {
                args.push('--font-path', fp)
            }

            // Run the typst CLI
            await run_typst(typst_path, args)

            // Read and return the compiled PDF
            return new Uint8Array(await readFile(output_path))

        } finally {
            // Clean up temp directory
            await rm(tmp_dir, {recursive: true, force: true})
        }
    }
}


// Execute the typst CLI and return a promise
function run_typst(typst_path:string, args:string[]):Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(typst_path, args, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr || stdout || error.message
                reject(new Error(`Typst compilation failed: ${msg}`))
            } else {
                resolve()
            }
        })
    })
}
