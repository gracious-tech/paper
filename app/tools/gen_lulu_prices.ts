
// Generate src/services/lulu_prices.json from Lulu's published product spec sheet, so the cost
// estimate quotes real prices without hard-coding any and without needing Lulu's credentials
// (their cost-calculation API is authenticated; this spreadsheet is public). Wired into
// .bin/deploy_app, so every deploy ships current prices — run .bin/gen_lulu_prices to refresh
// by hand. The output is committed, which keeps builds working offline and makes a Lulu
// re-price show up as a reviewable diff.
//
// The sheet is an .xlsx: a ZIP of XML. Both are unpacked here with node built-ins rather than
// pulling in a spreadsheet library for two columns of numbers.

import {inflateRawSync} from 'node:zlib'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

import {list_app_pod_package_ids, parse_pod_package_id} from '../src/services/lulu_skus.ts'


const SPEC_URL = 'https://assets.lulu.com/media/specs/lulu-print-api-spec-sheet.xlsx'

// This file lives in <repo>/app/tools/
const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(TOOLS_DIR, '..', 'src', 'services', 'lulu_prices.json')

// Currencies Lulu quotes in, and the "Full Spec Sheet" columns holding each one's base price
// and per-page price (0-indexed)
const CURRENCIES = [
    {code: 'USD', base: 5, per_page: 6},
    {code: 'GBP', base: 7, per_page: 8},
    {code: 'EUR', base: 9, per_page: 10},
    {code: 'AUD', base: 11, per_page: 12},
    {code: 'CAD', base: 13, per_page: 14},
] as const

// Other columns of interest
const COL_SKU = 1
const COL_MIN_PAGES = 3
const COL_MAX_PAGES = 4



// One entry of a ZIP file, located via the central directory
interface ZipEntry {name:string, offset:number, compressed:number, method:number}


// List a ZIP's entries by reading its central directory. Going via the directory rather than
// walking local headers is not optional here: every entry in Lulu's file sets the data-
// descriptor flag, which leaves the sizes in the local headers as zero
function read_zip_entries(buffer:Buffer):ZipEntry[]{
    // The end-of-central-directory record sits at the very end, after a comment of unknown
    // length, so scan backwards for its signature
    let eocd = -1
    for (let i = buffer.length - 22; i >= 0; i--){
        if (buffer.readUInt32LE(i) === 0x06054b50){
            eocd = i
            break
        }
    }
    if (eocd === -1){
        throw new Error('not a zip file (no end-of-central-directory record)')
    }
    const count = buffer.readUInt16LE(eocd + 10)
    let offset = buffer.readUInt32LE(eocd + 16)
    const entries:ZipEntry[] = []
    for (let i = 0; i < count; i++){
        if (buffer.readUInt32LE(offset) !== 0x02014b50){
            throw new Error('corrupt zip central directory')
        }
        const name_length = buffer.readUInt16LE(offset + 28)
        const extra_length = buffer.readUInt16LE(offset + 30)
        const comment_length = buffer.readUInt16LE(offset + 32)
        entries.push({
            name: buffer.toString('utf8', offset + 46, offset + 46 + name_length),
            method: buffer.readUInt16LE(offset + 10),
            compressed: buffer.readUInt32LE(offset + 20),
            offset: buffer.readUInt32LE(offset + 42),
        })
        offset += 46 + name_length + extra_length + comment_length
    }
    return entries
}


// Pull one entry out of the ZIP as text
function read_zip_file(buffer:Buffer, entries:ZipEntry[], name:string):string{
    const entry = entries.find(item => item.name === name)
    if (!entry){
        throw new Error(`${name} missing from the spec sheet`)
    }
    // The local header repeats the name and extra fields, whose lengths vary from the central
    // directory's, so re-read them here to find where the data actually starts
    const name_length = buffer.readUInt16LE(entry.offset + 26)
    const extra_length = buffer.readUInt16LE(entry.offset + 28)
    const start = entry.offset + 30 + name_length + extra_length
    const data = buffer.subarray(start, start + entry.compressed)
    // Method 0 is stored, 8 is deflate — xlsx uses no others
    if (entry.method === 0){
        return data.toString('utf8')
    }
    if (entry.method !== 8){
        throw new Error(`${name} uses unsupported zip compression method ${entry.method}`)
    }
    return inflateRawSync(data).toString('utf8')
}


// Undo the XML escaping used in the sheet's shared strings
function unescape_xml(text:string):string{
    return text.replace(/&(lt|gt|amp|quot|apos|#39);/g, (whole, name:string) => {
        return {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'"}[name] ?? whole
    })
}


// The workbook's shared string table — cells of type "s" hold an index into this
function parse_shared_strings(xml:string):string[]{
    return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map(match => {
        // A string can be split across several runs; concatenate every <t> inside the entry
        return [...(match[1] ?? '').matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
            .map(run => unescape_xml(run[1] ?? '')).join('')
    })
}


// Read a worksheet into rows of plain cell values, resolving shared strings as it goes.
// Skipped (empty) cells are filled in from each cell's column reference, so column indexes
// stay aligned with the header row
function parse_sheet(xml:string, shared:string[]):string[][]{
    return [...xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(row => {
        const cells:string[] = []
        for (const cell of (row[1] ?? '').matchAll(/<c ([^>]*?)\/?>(?:(.*?)<\/c>)?/gs)){
            const attributes = cell[1] ?? ''
            const reference = /r="([A-Z]+)/.exec(attributes)?.[1]
            if (reference){
                // "A" -> 0, "B" -> 1, ... "AA" -> 26
                let index = 0
                for (const letter of reference){
                    index = index * 26 + (letter.charCodeAt(0) - 64)
                }
                while (cells.length < index - 1){
                    cells.push('')
                }
            }
            const value = /<v>(.*?)<\/v>/s.exec(cell[2] ?? '')?.[1] ?? ''
            const is_shared = /t="s"/.test(attributes)
            cells.push(is_shared ? shared[Number(value)] ?? '' : unescape_xml(value))
        }
        return cells
    })
}


// Every product the app can produce, paired with the key its prices are stored under
function wanted_skus():Map<string, string>{
    const wanted = new Map<string, string>()
    for (const sku of list_app_pod_package_ids()){
        const parts = parse_pod_package_id(sku)
        if (parts){
            wanted.set(sku, parts.price_key)
        }
    }
    return wanted
}


// Fetch the sheet, pull out the prices and page limits, and write the JSON the app imports
async function generate():Promise<void>{
    console.log(`Fetching ${SPEC_URL}`)
    const response = await fetch(SPEC_URL)
    if (!response.ok){
        throw new Error(`could not fetch Lulu's spec sheet (${response.status})`)
    }
    const modified = response.headers.get('last-modified')
    const buffer = Buffer.from(await response.arrayBuffer())
    console.log(`  ${buffer.length.toLocaleString()} bytes, last modified ${modified}`)

    const entries = read_zip_entries(buffer)
    const shared = parse_shared_strings(
        read_zip_file(buffer, entries, 'xl/sharedStrings.xml'))
    // Sheet 2 is the "Full Spec Sheet" tab; sheet 1 is the component legend
    const rows = parse_sheet(read_zip_file(buffer, entries, 'xl/worksheets/sheet2.xml'), shared)
    console.log(`  ${rows.length.toLocaleString()} rows, ${shared.length.toLocaleString()}`
        + ' shared strings')

    const wanted = wanted_skus()
    const prices:Record<string, number[][]> = {}
    const page_limits:Record<string, [number, number]> = {}
    const seen = new Set<string>()
    for (const row of rows){
        const sku = row[COL_SKU]
        const key = sku && wanted.get(sku)
        if (!key){
            continue
        }
        seen.add(sku)
        prices[key] = CURRENCIES.map(
            currency => [Number(row[currency.base]), Number(row[currency.per_page])])
        // Page limits hang off the whole SKU, since two products sharing a price key can still
        // differ here — the landscape trims cap perfect binding far lower than the rest
        page_limits[sku] = [Number(row[COL_MIN_PAGES]), Number(row[COL_MAX_PAGES])]
    }

    // A SKU vanishing means Lulu stopped selling something the app still offers — worth failing
    // on rather than shipping an estimate with a hole in it
    const missing = [...wanted.keys()].filter(sku => !seen.has(sku))
    if (missing.length){
        throw new Error(`${missing.length} product(s) missing from Lulu's sheet, `
            + `e.g. ${missing.slice(0, 3).join(', ')}`)
    }
    for (const [key, row] of Object.entries(prices)){
        if (row.some(pair => pair.some(value => !Number.isFinite(value)))){
            throw new Error(`non-numeric price for ${key} — has the sheet's layout changed?`)
        }
    }

    // Keep the previous "generated" date when nothing else changed, so a re-run with
    // unchanged upstream data doesn't dirty the git repo with a date-only diff
    let generated = new Date().toISOString().slice(0, 10)
    if (existsSync(OUT_PATH)){
        const previous = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as {
            source_modified?:string, currencies?:string[]
            prices?:Record<string, number[][]>, page_limits?:Record<string, [number, number]>
            generated?:string
        }
        const unchanged = previous.source_modified === modified
            && JSON.stringify(previous.currencies) === JSON.stringify(CURRENCIES.map(item => item.code))
            && JSON.stringify(previous.prices) === JSON.stringify(prices)
            && JSON.stringify(previous.page_limits) === JSON.stringify(page_limits)
        if (unchanged && previous.generated){
            generated = previous.generated
        }
    }

    writeFileSync(OUT_PATH, JSON.stringify({
        source: SPEC_URL,
        source_modified: modified,
        generated,
        currencies: CURRENCIES.map(item => item.code),
        prices,
        page_limits,
    }, null, 2) + '\n')
    console.log(`Wrote ${Object.keys(prices).length} price rows and `
        + `${Object.keys(page_limits).length} page limits to ${OUT_PATH}`)
}


await generate()
