
// Minimal TTF/OTF binary parsing — reads a font's family name and serif/sans classification
// straight from its own tables, for fonts that have no manifest entry (e.g. user-uploaded
// custom fonts). Pure Uint8Array/DataView parsing, no filesystem or DOM dependency.

import type {FontStyle} from './noto.js'

// Find a table's byte offset in a TTF/OTF file's table directory, or 0 if absent
function find_table(view:DataView, wanted:string):number {
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

// Parse the font family name from a TTF/OTF file's name table
export function parse_font_family(data:Uint8Array):string | null {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const name_offset = find_table(view, 'name')
        if (!name_offset)
            return null

        // Parse name records
        const count = view.getUint16(name_offset + 2)
        const string_storage = name_offset + view.getUint16(name_offset + 4)

        for (let i = 0; i < count; i++) {
            const rec = name_offset + 6 + i * 12
            const platform_id = view.getUint16(rec)
            const name_id = view.getUint16(rec + 6)
            const length = view.getUint16(rec + 8)
            const offset = view.getUint16(rec + 10)

            // nameID 1 = Font Family name
            if (name_id !== 1)
                continue

            const str_start = string_storage + offset

            // Platform 3 (Windows) — UTF-16BE encoding
            if (platform_id === 3) {
                const chars:number[] = []
                for (let j = 0; j < length; j += 2) {
                    chars.push(view.getUint16(str_start + j))
                }
                return String.fromCharCode(...chars)
            }

            // Platform 1 (Mac) — ASCII-like encoding
            if (platform_id === 1) {
                const chars:number[] = []
                for (let j = 0; j < length; j++) {
                    chars.push(view.getUint8(str_start + j))
                }
                return String.fromCharCode(...chars)
            }
        }
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
