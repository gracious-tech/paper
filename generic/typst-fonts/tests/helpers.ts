
// Minimal synthetic TTF binary builder, for testing sfnt.ts's table parsing (and anything built
// on it, like custom.ts's process_font_files) without needing a real font file fixture.

// Build a minimal valid TTF: a 'name' table (with a Windows-platform Family name record) and,
// unless no_os2 is set, an 'OS/2' table whose sFamilyClass high byte is family_class (0 = absent
// classification, exercising the PANOSE/name fallback paths in parse_font_style)
export function build_test_font(opts:{family:string, family_class?:number, no_os2?:boolean}):Uint8Array {
    const family_utf16 = [...opts.family].map(ch => ch.charCodeAt(0))
    const family_bytes_len = family_utf16.length * 2

    const name_table_len = 18 + family_bytes_len
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
    view.setUint32(0, 0x00010000)
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

    // 'name' table: format 0, one Windows-platform (id 3) Family (nameID 1) record
    view.setUint16(name_offset, 0)
    view.setUint16(name_offset + 2, 1)
    view.setUint16(name_offset + 4, 18)
    const rec = name_offset + 6
    view.setUint16(rec, 3)
    view.setUint16(rec + 2, 1)
    view.setUint16(rec + 4, 0x0409)
    view.setUint16(rec + 6, 1)
    view.setUint16(rec + 8, family_bytes_len)
    view.setUint16(rec + 10, 0)
    const str_start = name_offset + 18
    family_utf16.forEach((code, i) => view.setUint16(str_start + i * 2, code))

    // 'OS/2' table: sFamilyClass high byte only (rest left zeroed — PANOSE bytes 0 too, so a
    // family_class of 0/undefined exercises parse_font_style's "declares neither" null path)
    if (has_os2 && opts.family_class !== undefined) {
        buf[os2_offset + 30] = opts.family_class
    }

    return buf
}
