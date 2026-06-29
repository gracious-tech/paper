
import {execFile} from 'node:child_process'
import {writeFile, readFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {generate_typst, generate_pdf, generate_pdf_spread_preview, BibleContent,
    } from 'paper-bible-typst'

import type {TypstRequest, CompileFn, Blueprint} from 'paper-bible-typst'


// Options for the Node.js Typst compiler wrapper
export interface NodeCompileOptions {
    // Path to the typst CLI binary (default: "typst")
    typst_path?:string
    // Additional font directories to pass to the typst CLI
    font_paths?:string[]
}


// Options for compiling straight from a Blueprint (adds Bible-content fetching config)
export interface BlueprintCompileOptions extends NodeCompileOptions {
    // Bible content API endpoint (defaults to production fetch.bible)
    endpoint?:string
    // Title-page decorative patterns, keyed by pattern name → corner SVG string
    patterns?:Record<string, string>
}


// Compile a TypstRequest to PDF using the official Typst CLI
// Handles the full pipeline: generate → compile → post-process
export async function compile_pdf(
    request:TypstRequest, options?:NodeCompileOptions,
):Promise<Uint8Array> {
    const compile_fn = make_compile_fn(options)
    return generate_pdf(request, compile_fn)
}


// Compile a TypstRequest to a preview PDF laid out as facing-page book spreads
export async function compile_pdf_spread_preview(
    request:TypstRequest, options?:NodeCompileOptions,
):Promise<Uint8Array> {
    const compile_fn = make_compile_fn(options)
    return generate_pdf_spread_preview(request, compile_fn)
}


// Compile straight from the user's selected options (Blueprint) to a finished PDF: fetches and
// caches the Bible content internally, resolves it to a TypstRequest, then compiles. This is
// the server "hand it the options, get a PDF" path — no separate fetch logic required.
export async function compile_pdf_from_blueprint(
    blueprint:Blueprint, options?:BlueprintCompileOptions,
):Promise<Uint8Array> {
    const content = new BibleContent({
        endpoint: options?.endpoint,
        patterns: options?.patterns,
    })
    await content.init()
    const request = await content.resolve(blueprint)
    return generate_pdf(request, make_compile_fn(options))
}


// Re-export the inner function for generating just the Typst source
export {generate_typst} from 'paper-bible-typst'

// Re-export all types
export type {
    TypstRequest, PageConfig, TypographyConfig, TypstContentItem,
    TypstPassage, BiblePassageData, TypstTitlePage, TypstCustomPage,
    TypstLinesPage, CompileFn,
    Blueprint, ContentItem, ContentTitle, ContentPassage, ContentCustom,
} from 'paper-bible-typst'


// Create a compile function that uses the Typst CLI
function make_compile_fn(options?:NodeCompileOptions):CompileFn {
    const typst_path = options?.typst_path ?? 'typst'
    const font_paths = options?.font_paths ?? []

    return async (source:string):Promise<Uint8Array> => {
        // Create a temp directory for this compilation
        const tmp_dir = await mkdtemp(join(tmpdir(), 'typst-'))
        const input_path = join(tmp_dir, 'input.typ')
        const output_path = join(tmp_dir, 'output.pdf')

        try {
            // Write the Typst source to a temp file
            await writeFile(input_path, source, 'utf-8')

            // Build CLI arguments
            const args = ['compile', input_path, output_path]
            for (const fp of font_paths) {
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
