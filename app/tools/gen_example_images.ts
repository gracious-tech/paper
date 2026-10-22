
// Render the 3D pictures of the example designs' covers (the cards in DisplayExamples.vue), one
// set per UI locale since each cover carries the example's translated title. Run locally via
// .bin/gen_example_images after changing an example or its titles' translations, and commit the
// results — nothing renders them in CI or in a visitor's browser.
//
// The rendering itself happens in Chromium (bookcover's 3D renderer needs WebGL), in a page on the
// app's own Vite dev server running app/tools/example_images/harness.ts, so the covers come out of
// exactly the code the app uses. Each picture is keyed by a hash of everything it depends on, kept
// in the manifest beside them, so only what changed is re-rendered. A locale whose picture would
// be identical to English's gets none of its own (the app falls back to English's).
//
// Usage: .bin/gen_example_images [--force] [locale ...]

import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

import {MANIFEST_PATH, IMAGES_DIR, read_manifest} from './example_images_manifest.ts'

import type {Page} from '@playwright/test'
import type {ViteDevServer} from 'vite'
import type {ExampleManifest} from './example_images_manifest.ts'


// This file lives in <repo>/app/tools/
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_DIR = join(APP_DIR, '..')

// The page the harness module is loaded into (answered by the route below, never by Vite, whose
// HTML handling would serve the app itself — see vite_plugin_index.mts)
const HARNESS_PAGE = '/__example_images'
const HARNESS_HTML = `<!doctype html><meta charset="utf-8"><script type="module">
    import('/tools/example_images/harness.ts').then(
        module => {window.harness = module},
        error => {window.harness_error = String(error)},
    )
</script>`

// What the harness says about one example (mirrors ExampleInfo in example_images/harness.ts,
// which is browser code this tsconfig can't follow into)
interface ExampleInfo {
    id:string
    hash:string
    title:string
    subtitle:string
}

// The harness module's exports as the page exposes them, or why it failed to load
interface HarnessWindow {
    harness_error?:string
    harness?:{
        describe_examples(locale:string):Promise<ExampleInfo[]>
        render_example(id:string, locale:string):Promise<string>
    }
}


const force = process.argv.includes('--force')
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'))

// Every UI locale, English first since the others are compared against it
const locales_meta = JSON.parse(readFileSync(join(APP_DIR, 'src', 'locales.json'), 'utf8')) as
    {locales:Record<string, unknown>}
const all_locales = ['en', ...Object.keys(locales_meta.locales).filter(loc => loc !== 'en')]
for (const loc of only){
    if (!all_locales.includes(loc)){
        throw new Error(`Unknown locale "${loc}" (see app/src/locales.json)`)
    }
}

// Covers render with the production assets and Bible content, so no other dev server is needed
// (read by vite.config.mts when the server starts)
process.env['USE_PROD_SERVICES'] = 'true'
process.env['PLAYWRIGHT_BROWSERS_PATH'] ??= join(REPO_DIR, 'e2e', 'browsers')

// (both read their environment when imported, so only after it's set)
const {chromium} = await import('@playwright/test')
const {createServer} = await import('vite')
const server = await createServer({
    configFile: join(APP_DIR, 'vite.config.mts'),
    root: APP_DIR,
    logLevel: 'warn',
    server: {port: 5390, strictPort: false},
})
await server.listen()
// WebGL in headless Chromium runs on SwiftShader, which Chromium only allows when asked to
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})

try {
    await generate(server_url(server))
} finally {
    await browser.close()
    await server.close()
}


// The dev server's own address
function server_url(server:ViteDevServer):string{
    const url = server.resolvedUrls?.local[0]
    if (!url){
        throw new Error('Vite dev server has no local address')
    }
    return url.replace(/\/$/, '')
}


// Bring every locale's pictures up to date, then rewrite the manifest
async function generate(base:string):Promise<void>{
    const manifest = read_manifest()
    const updated:ExampleManifest = {}
    let en_infos:ExampleInfo[] = []
    let rendered = 0
    const failed:string[] = []

    for (const loc of all_locales){
        // Locales left out of a partial run keep what they had (English is always described,
        // since the others are compared against it, but only rendered when asked for)
        const wanted = !only.length || only.includes(loc)
        if (!wanted && loc !== 'en'){
            if (manifest[loc]){
                updated[loc] = manifest[loc]
            }
            continue
        }

        // A fresh browser context per locale, so the page's language (which picks the paper size
        // a home-printed example guesses) is that locale's own
        const context = await browser.newContext({locale: loc})
        try {
            const page = await open_harness(context.newPage(), base)
            const infos = await page.evaluate(loc => (window as HarnessWindow).harness!
                .describe_examples(loc), loc)
            if (loc === 'en'){
                en_infos = infos
            }

            updated[loc] = {}
            for (const info of infos){
                const file = join(IMAGES_DIR, loc, `${info.id}.webp`)
                const previous = manifest[loc]?.[info.id]
                const same_as_en = loc !== 'en'
                    && en_infos.find(en => en.id === info.id)?.hash === info.hash
                const entry = {hash: info.hash, title: info.title, subtitle: info.subtitle}

                // Identical to English's picture: none of its own
                if (same_as_en){
                    rmSync(file, {force: true})
                    updated[loc][info.id] = {...entry, file: false}
                    continue
                }

                // Unchanged since the last render (or not asked for)
                const current = previous?.hash === info.hash && previous.file && existsSync(file)
                if ((current && !force) || !wanted){
                    if (previous){
                        updated[loc][info.id] = previous
                    }
                    continue
                }

                // Render it. A failure keeps whatever was there before (or nothing, so the app
                // shows English's) and is reported at the end rather than stopping the others
                const started = Date.now()
                let webp:string
                try {
                    webp = await page.evaluate(([id, loc]) => (window as HarnessWindow).harness!
                        .render_example(id, loc), [info.id, loc] as const)
                } catch (error){
                    failed.push(`${loc}/${info.id}: ${String(error).split('\n').slice(0, 3).join(' ')}`)
                    if (previous){
                        updated[loc][info.id] = previous
                    }
                    continue
                }
                mkdirSync(dirname(file), {recursive: true})
                writeFileSync(file, Buffer.from(webp, 'base64'))
                updated[loc][info.id] = {...entry, file: true}
                rendered += 1
                console.log(`${loc}/${info.id}  ${info.title} — ${info.subtitle}`
                    + `  (${Date.now() - started}ms)`)
            }
        } finally {
            await context.close()
        }
    }

    // Drop pictures no example or locale needs any more (only in locale folders this tool made)
    for (const loc of new Set([...all_locales, ...Object.keys(manifest)])){
        const dir = join(IMAGES_DIR, loc)
        if (existsSync(dir)){
            for (const name of readdirSync(dir)){
                if (!updated[loc]?.[name.replace(/\.webp$/, '')]?.file){
                    rmSync(join(dir, name))
                }
            }
            if (!readdirSync(dir).length){
                rmSync(dir, {recursive: true})
            }
        }
    }

    writeFileSync(MANIFEST_PATH, JSON.stringify(updated, null, 4) + '\n')
    console.log(`${rendered} picture(s) rendered`)
    if (failed.length){
        console.error(`${failed.length} failed to render:\n  ${failed.join('\n  ')}`)
        process.exitCode = 1
    }
}


// Load the harness into a page, retrying once: the dev server may still be optimising the app's
// dependencies on first use, which fails the imports of a page that loaded too early
async function open_harness(page_promise:Promise<Page>, base:string):Promise<Page>{
    const page = await page_promise
    page.on('pageerror', error => console.error(`[page] ${error.message}`))
    page.on('console', message => {
        if (message.type() === 'error'){
            console.error(`[console] ${message.text()}`)
        }
    })
    await page.route(base + HARNESS_PAGE, route => route.fulfill(
        {contentType: 'text/html', body: HARNESS_HTML}))
    for (let attempt = 1; ; attempt++){
        await page.goto(base + HARNESS_PAGE)
        await page.waitForFunction(() => {
            const win = window as HarnessWindow
            return !!(win.harness || win.harness_error)
        }, undefined, {timeout: 120_000})
        const error = await page.evaluate(() => (window as HarnessWindow).harness_error)
        if (!error){
            return page
        }
        if (attempt >= 2){
            throw new Error(`Harness failed to load: ${error}`)
        }
    }
}
