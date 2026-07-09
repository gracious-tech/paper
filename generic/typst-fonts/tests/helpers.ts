
// Minimal synthetic TTF binary builder, for testing sfnt.ts's table parsing (and anything built
// on it, like custom.ts's process_font_files) without needing a real font file fixture.

/** One name-table record to embed in a synthetic test font */
export interface TestNameRecord {
    platform_id:number
    name_id:number
    value:string
}

// Encode one name record's string bytes: Windows platform (3) UTF-16BE, Mac (1) single-byte
function encode_name(platform_id:number, value:string):number[] {
    const bytes:number[] = []
    for (const ch of value) {
        const code = ch.charCodeAt(0)
        if (platform_id === 3) {
            bytes.push(code >> 8, code & 0xFF)
        } else {
            bytes.push(code & 0xFF)
        }
    }
    return bytes
}

// Build a minimal valid TTF: a 'name' table (by default one Windows-platform Family record for
// opts.family, or the explicit opts.name_records) and, unless no_os2 is set, an 'OS/2' table
// whose sFamilyClass high byte is family_class (0 = absent classification, exercising the
// PANOSE/name fallback paths in parse_font_style). opts.version overrides the sfnt version tag
// to test rejection of non-font data.
export function build_test_font(opts:{
    family:string,
    family_class?:number,
    no_os2?:boolean,
    name_records?:TestNameRecord[],
    version?:number,
}):Uint8Array {
    const records = opts.name_records
        ?? [{platform_id: 3, name_id: 1, value: opts.family}]
    const encoded = records.map(r => encode_name(r.platform_id, r.value))
    const strings_len = encoded.reduce((sum, bytes) => sum + bytes.length, 0)

    const name_header_len = 6 + records.length * 12
    const name_table_len = name_header_len + strings_len
    const os2_table_len = 40
    const has_os2 = !opts.no_os2
    const num_tables = has_os2 ? 2 : 1

    const header_len = 12
    const dir_len = num_tables * 16
    const name_offset = header_len + dir_len
    const os2_offset = name_offset + name_table_len
    const total_len = os2_offset + (has_os2 ? os2_table_len : 0)

    const buf = new Uint8Array(total_len)
    const view = new DataView(buf.buffer)

    // Offset table header
    view.setUint32(0, opts.version ?? 0x00010000)
    view.setUint16(4, num_tables)

    // Table directory
    const write_dir_entry = (rec:number, tag:string, t_offset:number, t_len:number) => {
        for (let i = 0; i < 4; i++) buf[rec + i] = tag.charCodeAt(i)
        view.setUint32(rec + 4, 0)
        view.setUint32(rec + 8, t_offset)
        view.setUint32(rec + 12, t_len)
    }
    write_dir_entry(header_len, 'name', name_offset, name_table_len)
    if (has_os2) write_dir_entry(header_len + 16, 'OS/2', os2_offset, os2_table_len)

    // 'name' table: format 0 header, then one 12-byte record per entry, then string storage
    view.setUint16(name_offset, 0)
    view.setUint16(name_offset + 2, records.length)
    view.setUint16(name_offset + 4, name_header_len)
    let string_offset = 0
    records.forEach((record, i) => {
        const rec = name_offset + 6 + i * 12
        view.setUint16(rec, record.platform_id)
        view.setUint16(rec + 2, record.platform_id === 3 ? 1 : 0)
        view.setUint16(rec + 4, record.platform_id === 3 ? 0x0409 : 0)
        view.setUint16(rec + 6, record.name_id)
        view.setUint16(rec + 8, encoded[i]!.length)
        view.setUint16(rec + 10, string_offset)
        string_offset += encoded[i]!.length
    })
    const str_start = name_offset + name_header_len
    encoded.flat().forEach((byte, i) => {
        buf[str_start + i] = byte
    })

    // 'OS/2' table: sFamilyClass high byte only (rest left zeroed — PANOSE bytes 0 too, so a
    // family_class of 0/undefined exercises parse_font_style's "declares neither" null path)
    if (has_os2 && opts.family_class !== undefined) {
        buf[os2_offset + 30] = opts.family_class
    }

    return buf
}
