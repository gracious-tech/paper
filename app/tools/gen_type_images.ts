// Render the new-design wizard's type pictures (src/assets/images/design_types/) in each UI
// locale's own Bible. English's are hand-cropped screenshots (type_<name>.avif); every other
// locale gets <locale>/type_<name>.avif: Genesis 1 in fetch.bible's preferred translation for
// that language, laid out and cropped to match the English screenshot. Each type's settings and
// crop in TYPES were calibrated once, by rendering English with them and overlaying the result
// on its screenshot, so a new locale needs nothing but a run of this script.
//
// Pages are compiled from a real Blueprint the way the server does (BibleContent.resolve() →
// generate_typst() → Typst CLI), straight to PNG at the scale the crop expects. Fonts are
// downloaded on demand from the assets bucket into app/tools/.cache/ (gitignored), and so is a
// review sheet per locale: each English screenshot beside its new picture.
//
// Usage: .bin/gen_type_images [--force] [--types=standard,notes] [locale ...]
// With no locales, renders every UI locale missing from the manifest (all of them with --force)

import {execFile} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import sharp from 'sharp'
import {load_fonts_dir, resolve_font_dirs} from 'typst-fonts/node'
import {get_noto_font} from 'typst-fonts'
import {BibleContent, collect_fonts, generate_typst, get_bundled_font} from 'paper-bible-typst'

import {build_blueprint} from '../../e2e/tiers.ts'
import {IMAGES_DIR, MANIFEST_PATH, read_type_images_manifest} from './type_images_manifest.ts'

import type {Blueprint} from 'paper-bible-typst'


// This file lives in <repo>/app/tools/
const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = join(TOOLS_DIR, '..', '..')
const CACHE_DIR = join(TOOLS_DIR, '.cache', 'type_images')
const FONTS_DIR = join(CACHE_DIR, 'fonts')
const REVIEW_DIR = join(CACHE_DIR, 'review')
const TYPST = join(REPO_DIR, '.bin', 'typst')
const FONTS_URL = 'https://assets.paper.bible/fonts/'

// The pictures' size, which the English screenshots set
const WIDTH = 700
const HEIGHT = 350

// The calibration's reference resolution: each type's scale is relative to it
const BASE_PPI = 600

// White margin added around a rendered page, so a crop may extend past a narrow page's edges
const PAD = 800

// The English screenshots' font, used for every Bible in a script it covers (Latin); any other
// gets Noto Serif, plus whatever script fallback the resolver adds, as the app itself would
const SCREENSHOT_FONT = 'Crimson Pro'
const LATIN_LANGS = new Set(['eng', 'deu', 'spa', 'fra', 'ind', 'ita', 'por', 'tur', 'vie'])


// How one type is rendered and cropped
interface TypeConfig {
    // Blueprint fields over the base (see make_blueprint)
    blueprint:Partial<Blueprint>
    // The last verse of Genesis 1 to include
    end_verse:number
    // Draw the opening chapter numeral, which a passage starting on a chapter normally hides
    chapter_numeral:boolean
    // Set English (SECOND_BIBLE) beside the locale's translation
    second_bible?:true
    // Scale relative to BASE_PPI, and the crop's top-left corner on the page at that scale
    scale:number
    left:number
    top:number
}

// The five types. Page sizes reproduce each screenshot's line breaks: notes, study and bilingual
// were taken from narrower pages than A4. Notes also borrows the screenshot's dotted lines (the
// app now puts them on the facing page), and study closes up the page's slack above its notes
// (see crop_study)
const TYPES:Record<string, TypeConfig> = {
    standard: {
        blueprint: {show_chapters_style: 'float', show_headings_italic: true, line_height: 1.3},
        end_verse: 8, chapter_numeral: true, scale: 0.481, left: 34, top: 66,
    },
    reading: {
        blueprint: {line_height: 1.3, columns: false, show_headings: false, show_chapters: false,
            show_verses: false},
        end_verse: 8, chapter_numeral: false, scale: 0.48, left: 71, top: 46,
    },
    notes: {
        blueprint: {line_height: 1.6, justify: true, size_id: '', custom_trim_width: 51,
            custom_trim_height: 120},
        end_verse: 8, chapter_numeral: false, scale: 0.478, left: 88, top: 65,
    },
    study: {
        blueprint: {line_height: 1.3, show_headings: false, notes: 'eng_tyndale', size_id: '',
            custom_trim_width: 130, custom_trim_height: 110},
        end_verse: 2, chapter_numeral: false, scale: 0.482, left: 86, top: 0,
    },
    bilingual: {
        blueprint: {line_height: 1.3, justify: true, size_id: '', custom_trim_width: 90,
            custom_trim_height: 120},
        end_verse: 8, chapter_numeral: false, second_bible: true, scale: 0.481, left: 95, top: 61,
    },
}

// Blueprint fields for one language's picture of one type, where the calibrated layout doesn't
// suit its text: Tamil's long words overflow the bilingual picture's narrow columns otherwise
const LANGUAGE_OVERRIDES:Record<string, Record<string, Partial<Blueprint>>> = {
    tam: {bilingual: {custom_trim_width: 110}},
}

// The second translation of the bilingual picture
const SECOND_BIBLE = 'eng_bsb'

// Where the notes screenshot's dotted lines start
const NOTES_LINES_X = 390


// Parse the command line
const args = process.argv.slice(2)
const force = args.includes('--force')
const types_arg = args.find(arg => arg.startsWith('--types='))?.slice('--types='.length)
const types = types_arg ? types_arg.split(',') : Object.keys(TYPES)
const locales_arg = args.filter(arg => !arg.startsWith('--'))
for (const type of types){
    if (!(type in TYPES)){
        throw new Error(`Unknown type "${type}" (one of ${Object.keys(TYPES).join(', ')})`)
    }
}
if (!existsSync(TYPST)){
    throw new Error('No Typst CLI at .bin/typst (run .bin/setup_typst)')
}

// Which locales to render
const {default: locales_meta} = await import('../src/locales.json', {with: {type: 'json'}})
const manifest = read_type_images_manifest()
const all_locales = Object.keys(locales_meta.locales).filter(loc => loc !== 'en')
for (const loc of locales_arg){
    if (!all_locales.includes(loc)){
        throw new Error(`"${loc}" isn't a UI locale (see app/src/locales.json)`)
    }
}
const locales = locales_arg.length ? locales_arg
    : all_locales.filter(loc => force || !(loc in manifest))

// Load the curated font manifest before resolving anything (the resolver's script detection
// reads it), then the Bible collection
mkdirSync(FONTS_DIR, {recursive: true})
await download(`${FONTS_URL}manifest.json`, join(FONTS_DIR, 'manifest.json'))
await load_fonts_dir(FONTS_DIR)
const content = new BibleContent({})
await content.init()

// Render each locale, saving the manifest after each so an interrupted run keeps its progress
for (const loc of locales){
    const bible = choose_bible(loc)
    if (!bible){
        console.info(`${loc}: no Bible with Genesis in this language, so it shows the English`
            + ' pictures')
        manifest[loc] = {bible: null}
    } else {
        console.info(`${loc}: ${bible.id} (${bible.name_english})`)
        const pictures:Record<string, Buffer> = {}
        for (const type of types){
            pictures[type] = await render_type(type, bible.id, bible.language, bible.direction)
        }
        const dir = join(IMAGES_DIR, loc)
        mkdirSync(dir, {recursive: true})
        for (const [type, png] of Object.entries(pictures)){
            await sharp(png).avif({quality: 60}).toFile(join(dir, `type_${type}.avif`))
        }
        await write_review(loc)
        manifest[loc] = {bible: bible.id}
    }
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 4) + '\n')
}


// The translation a locale's pictures are rendered in: fetch.bible's preferred one for the
// language, else (when that one lacks Genesis, like a New Testament) the first in the same
// language and script that has it. Null if the language has no Bible with Genesis at all
function choose_bible(loc:string):{id:string, language:string, direction:'ltr'|'rtl',
        name_english:string}|null{
    const preferred = content.collection.get_preferred_resource([loc])
    if (preferred.language === 'eng'){
        return null  // fetch.bible fell back to English: nothing in this language
    }
    if (content.collection.has_book(preferred.id, 'gen')){
        return preferred
    }
    return content.collection.get_resources({language: preferred.language,
        script: preferred.script, exclude_obsolete: true})
        .find(item => content.collection.has_book(item.id, 'gen')) ?? null
}


// Render one type's picture in a translation, as a 700x350 PNG
async function render_type(type:string, bible:string, language:string, dir:'ltr'|'rtl')
        :Promise<Buffer>{
    const config = TYPES[type]!
    const blueprint = {...make_blueprint(config, bible, language),
        ...LANGUAGE_OVERRIDES[language]?.[type]}
    const page = await render_page(blueprint, config)

    // Crop where the calibration says, mirrored for right-to-left text (which starts at the
    // page's right edge, so the crop has to as well)
    const {width} = await sharp(page).metadata()
    const padded = await sharp(page)
        .extend({left: PAD, right: PAD, bottom: HEIGHT * 2, background: '#ffffff'}).toBuffer()
    const left = dir === 'rtl' ? PAD + width! - config.left - WIDTH : PAD + config.left
    if (type === 'study'){
        return crop_study(padded, left)
    }
    const crop = await sharp(padded)
        .extract({left, top: config.top, width: WIDTH, height: HEIGHT}).png().toBuffer()
    return type === 'notes' ? add_note_lines(crop, dir) : crop
}


// The Blueprint for one type in one translation: the e2e suite's complete blueprint (kept
// current by its typechecks), as a single A4 page of Genesis 1 with nothing around the text
function make_blueprint(config:TypeConfig, bible:string, language:string):Blueprint{
    return build_blueprint({id: 'type_image', books: ['gen']}, {
        name: 'Type picture',
        bibles: config.second_bible ? [bible, SECOND_BIBLE] : [bible],
        content: [{type: 'passage', id: 'gen1', book: 'gen', start_chapter: 1, start_verse: null,
            end_chapter: 1, end_verse: config.end_verse, title: null, title_subtitle: '',
            title_icon: null, image: null}],
        font_text: LATIN_LANGS.has(language) ? SCREENSHOT_FONT : 'Noto Serif',
        size_id: 'a4',
        booklet: false,
        passage_title: null,
        running_pages: false,
        running_headings: false,
        show_footnotes: false,
        ...config.blueprint,
    })
}


// Compile a blueprint's first page to PNG at the type's scale
async function render_page(blueprint:Blueprint, config:TypeConfig):Promise<Buffer>{
    const request = await content.resolve(blueprint)
    let source = generate_typst(request)
    if (config.chapter_numeral){
        source = source.replace(/^#ch_quiet\(1\)$/m, '#ch(1)')
    }

    // Fetch whatever fonts this page needs that aren't cached yet
    const families = collect_fonts(request)
    for (const family of families){
        const bundled = get_bundled_font(family)
        const noto = bundled ? null : get_noto_font(family)
        const dir = bundled ? family : `_noto/${family}`
        for (const file of (bundled ?? noto)?.files ?? []){
            await download(`${FONTS_URL}${encodeURI(dir)}/${encodeURIComponent(file)}`,
                join(FONTS_DIR, dir, file))
        }
    }

    // Compile in a temp dir holding the source and any assets it names
    const tmp = mkdtempSync(join(tmpdir(), 'type-image-'))
    try {
        writeFileSync(join(tmp, 'input.typ'), source)
        for (const [name, bytes] of Object.entries(request.assets)){
            writeFileSync(join(tmp, name), bytes)
        }
        const font_args = resolve_font_dirs(FONTS_DIR, families).flatMap(d => ['--font-path', d])
        await promisify(execFile)(TYPST, ['compile', join(tmp, 'input.typ'), join(tmp, 'page.png'),
            '--format', 'png', '--pages', '1', '--ppi', String(BASE_PPI * config.scale), ...font_args])
        return await sharp(join(tmp, 'page.png')).flatten({background: '#ffffff'}).png().toBuffer()
    } finally {
        rmSync(tmp, {recursive: true, force: true})
    }
}


// The notes picture's dotted lines, taken from the English screenshot (they have no words), on
// the side of the text away from where it starts
async function add_note_lines(crop:Buffer, dir:'ltr'|'rtl'):Promise<Buffer>{
    let lines = sharp(join(IMAGES_DIR, 'type_notes.avif'))
        .extract({left: NOTES_LINES_X, top: 0, width: WIDTH - NOTES_LINES_X, height: HEIGHT})
    if (dir === 'rtl'){
        lines = lines.flop()
    }
    const left = dir === 'rtl' ? 0 : NOTES_LINES_X
    return sharp(crop).composite([{input: await lines.png().toBuffer(), left, top: 0}])
        .png().toBuffer()
}


// The study picture: the same margin above the first line of text, and the same gap between its
// last line and the notes' rule, as the screenshot has. The page's own gap depends on how much
// text fits above the notes, so it's closed up (or opened) to match
async function crop_study(padded:Buffer, left:number):Promise<Buffer>{
    const shot = await measure_study(await sharp(join(IMAGES_DIR, 'type_study.avif')).png().toBuffer(), 0)
    const page = await measure_study(padded, left)
    const top = page.first - shot.first
    const top_height = page.last + 4 - top
    const rule_top = page.rule - (shot.rule - (shot.last + 4))
    const piece = async (y:number, height:number) => sharp(padded)
        .extract({left, top: y, width: WIDTH, height}).png().toBuffer()
    return sharp({create: {width: WIDTH, height: HEIGHT, channels: 3, background: '#ffffff'}})
        .composite([
            {input: await piece(top, top_height), left: 0, top: 0},
            {input: await piece(rule_top, HEIGHT - top_height), left: 0, top: top_height},
        ]).png().toBuffer()
}


// The notes' rule (the row with the longest unbroken dark run anywhere across the page, since in
// right-to-left text it sits outside the crop and joined-up script could outrun it inside), and
// the first and last inked rows of the text above it within the crop's 700px-wide strip
async function measure_study(image:Buffer, left:number):Promise<{first:number, last:number, rule:number}>{
    const {data, info} = await sharp(image).greyscale().raw().toBuffer({resolveWithObject: true})
    const ink:number[] = []
    let rule = -1
    let rule_run = 0
    for (let y = 0; y < info.height; y++){
        let count = 0
        let run = 0
        for (let x = 0; x < info.width; x++){
            const dark = data[y * info.width + x]! < 128
            count += dark && x >= left && x < left + WIDTH ? 1 : 0
            run = dark ? run + 1 : 0
            if (run > rule_run){
                rule_run = run
                rule = y
            }
        }
        ink.push(count)
    }
    const text_rows = ink.slice(0, rule - 3).map((n, y) => n ? y : -1).filter(y => y >= 0)
    if (!text_rows.length){
        throw new Error('Study page has no text above its notes')
    }
    return {first: text_rows[0]!, last: text_rows[text_rows.length - 1]!, rule}
}


// Save a locale's review sheet: each English screenshot beside the locale's saved picture of
// it (every type, not just those this run rendered)
async function write_review(loc:string):Promise<void>{
    const rows = Object.keys(TYPES).filter(type => existsSync(join(IMAGES_DIR, loc, `type_${type}.avif`)))
    const sheet = sharp({create: {width: WIDTH * 2 + 8, height: rows.length * (HEIGHT + 8),
        channels: 3, background: '#888888'}})
    const png = (path:string) => sharp(path).png().toBuffer()
    const parts = await Promise.all(rows.flatMap((type, i) => [
        png(join(IMAGES_DIR, `type_${type}.avif`))
            .then(input => ({input, left: 0, top: i * (HEIGHT + 8)})),
        png(join(IMAGES_DIR, loc, `type_${type}.avif`))
            .then(input => ({input, left: WIDTH + 8, top: i * (HEIGHT + 8)})),
    ]))
    mkdirSync(REVIEW_DIR, {recursive: true})
    const path = join(REVIEW_DIR, `${loc}.png`)
    await sheet.composite(parts).png().toFile(path)
    console.info(`  review: ${path}`)
}


// Download a file unless it's already cached
async function download(url:string, path:string):Promise<void>{
    if (existsSync(path)){
        return
    }
    const resp = await fetch(url)
    if (!resp.ok){
        throw new Error(`Couldn't download ${url} (${resp.status})`)
    }
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, new Uint8Array(await resp.arrayBuffer()))
}
