
// Minimal TTF/OTF binary parsing — reads a font's family name and serif/sans classification
// straight from its own tables, for fonts that have no manifest entry (e.g. user-uploaded
// custom fonts). Pure Uint8Array/DataView parsing, no filesystem or DOM dependency.

import type {FontStyle} from './noto.js'

// Valid sfnt version tags: TrueType 0x00010000, OpenType CFF 'OTTO', plus the legacy Mac
// 'true'/'typ1' forms. Anything else isn't a single-font sfnt file (.ttc collections included)
// — bail out rather than misread arbitrary bytes as a table directory.
const SFNT_VERSIONS = new Set([0x00010000, 0x4F54544F, 0x74727565, 0x74797031])

// Find a table's byte offset in a TTF/OTF file's table directory, or 0 if absent
function find_table(view:DataView, wanted:string):number {
    if (!SFNT_VERSIONS.has(view.getUint32(0))) {
        return 0
    }
    // Read number of tables from the offset table, then scan the 16-byte table records
    const num_tables = view.getUint16(4)
    for (let i = 0; i < num_tables; i++) {
        const rec = 12 + i * 16
        const tag = String.fromCharCode(
            view.getUint8(rec), view.getUint8(rec + 1),
            view.getUint8(rec + 2), view.getUint8(rec + 3),
        )
        if (tag === wanted) {
            return view.getUint32(rec + 8)
        }
    }
    return 0
}

// Name-record preference for the family name, best first: the typographic family (nameID 16,
// e.g. 'Foo' when the legacy family is style-linked as 'Foo SemiBold') beats the legacy family
// (nameID 1), and Windows platform 3 (UTF-16, handles non-ASCII names) beats Mac platform 1
// (single-byte, garbles anything beyond ASCII)
const NAME_PREFERENCE = [
    {platform_id: 3, name_id: 16},
    {platform_id: 1, name_id: 16},
    {platform_id: 3, name_id: 1},
    {platform_id: 1, name_id: 1},
]

// Decode a name record's string: Windows platform is UTF-16BE, Mac platform single-byte
function decode_name(view:DataView, start:number, length:number, platform_id:number):string {
    const chars:number[] = []
    if (platform_id === 3) {
        for (let j = 0; j < length; j += 2) {
            chars.push(view.getUint16(start + j))
        }
    } else {
        for (let j = 0; j < length; j++) {
            chars.push(view.getUint8(start + j))
        }
    }
    return String.fromCharCode(...chars)
}

// Parse the font family name from a TTF/OTF file's name table (best available record per
// NAME_PREFERENCE above)
export function parse_font_family(data:Uint8Array):string | null {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const name_offset = find_table(view, 'name')
        if (!name_offset)
            return null

        // Scan all name records, keeping the best-preference non-empty family name seen
        const count = view.getUint16(name_offset + 2)
        const string_storage = name_offset + view.getUint16(name_offset + 4)
        let best:string | null = null
        let best_rank = NAME_PREFERENCE.length

        for (let i = 0; i < count; i++) {
            const rec = name_offset + 6 + i * 12
            const platform_id = view.getUint16(rec)
            const name_id = view.getUint16(rec + 6)
            const rank = NAME_PREFERENCE.findIndex(
                p => p.platform_id === platform_id && p.name_id === name_id)
            if (rank === -1 || rank >= best_rank)
                continue

            const length = view.getUint16(rec + 8)
            const offset = view.getUint16(rec + 10)
            const value = decode_name(view, string_storage + offset, length, platform_id)
            if (value) {
                best = value
                best_rank = rank
            }
        }
        return best
    } catch {
        // Malformed font file
    }
    return null
}

// Parse serif/sans classification from a font's OS/2 table — sFamilyClass first, then
// PANOSE. Returns null when the font declares neither (both are often zeroed).
export function parse_font_style(data:Uint8Array):FontStyle | null {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const os2_offset = find_table(view, 'OS/2')
        if (!os2_offset)
            return null

        // sFamilyClass high byte: class 8 = sans serif, classes 1-7 = serif designs
        const family_class = view.getUint8(os2_offset + 30)
        if (family_class === 8)
            return 'sans'
        if (family_class >= 1 && family_class <= 7)
            return 'serif'

        // PANOSE: byte 0 = family kind (2 = latin text), byte 1 = serif style
        // (2-10 = serif variants, 11-15 = sans variants)
        const panose_kind = view.getUint8(os2_offset + 32)
        const panose_serif = view.getUint8(os2_offset + 33)
        if (panose_kind === 2 && panose_serif >= 11)
            return 'sans'
        if (panose_kind === 2 && panose_serif >= 2)
            return 'serif'
    } catch {
        // Malformed font file
    }
    return null
}
