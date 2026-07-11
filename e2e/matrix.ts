
// Layout-option stress matrix: named blueprint variations compiled over fixed book sets, to
// isolate which specific options drive Typst memory. Run server-side via stress_matrix.ts and
// in the browser via stress_matrix.test.ts (both honor STRESS_CONFIGS="id,id" to filter).
//
// Book roles: psa = poetry worst case (baseline ~6.9GB CLI), jhn = prose control (~70MB),
// gen = large prose (50 chapters, ~100MB) for the forced-2-column discriminator.

import {OT_BOOKS, NT_BOOKS} from './tiers.ts'

import type {Blueprint} from 'paper-bible-typst'


// One matrix entry: a book set plus the blueprint fields that differ from the stress default
export interface StressConfig {
    id:string
    books:string[]
    overrides:Partial<Blueprint>
    note:string
}


// The full matrix, grouped by what each row is meant to isolate
export const MATRIX:StressConfig[] = [

    // Columns — the prime suspect: auto columns wrap LARGE_POETRY books in one giant
    // book-length #columns(2) block
    {id: 'psa_base', books: ['psa'], overrides: {},
        note: 'poetry baseline (auto = 2 columns, footnotes, justify)'},
    {id: 'psa_col1', books: ['psa'], overrides: {columns: false},
        note: 'poetry forced single column'},
    {id: 'jhn_base', books: ['jhn'], overrides: {},
        note: 'prose baseline (auto = 1 column)'},
    {id: 'jhn_col2', books: ['jhn'], overrides: {columns: true},
        note: 'prose forced 2 columns'},
    {id: 'gen_col2', books: ['gen'], overrides: {columns: true},
        note: 'large prose forced 2 columns'},

    // Footnotes — psa has plenty; also crossed with single-column to see interaction
    {id: 'psa_nofoot', books: ['psa'], overrides: {show_footnotes: false},
        note: 'poetry without footnotes'},
    {id: 'psa_col1_nofoot', books: ['psa'], overrides: {columns: false, show_footnotes: false},
        note: 'poetry single column without footnotes'},

    // Justification (default already resolves to justified on A4)
    {id: 'psa_nojust', books: ['psa'], overrides: {justify: false},
        note: 'poetry ragged-right'},
    {id: 'psa_col1_nojust', books: ['psa'], overrides: {columns: false, justify: false},
        note: 'poetry single column ragged-right'},

    // Study notes (replace translator footnotes, injected into the primary translation)
    {id: 'psa_notes', books: ['psa'], overrides: {notes: 'eng_tyndale'},
        note: 'poetry with Tyndale study notes'},
    {id: 'jhn_notes', books: ['jhn'], overrides: {notes: 'eng_tyndale'},
        note: 'prose with Tyndale study notes'},

    // Two translations — 'columns' renders one whole-book two-cell #grid, 'alternate'
    // compiles each translation as a separate document and interleaves pages afterwards
    {id: 'psa_bi_grid', books: ['psa'], overrides: {bibles: ['eng_bsb', 'eng_webp']},
        note: 'poetry bilingual side-by-side grid'},
    {id: 'psa_bi_alt', books: ['psa'],
        overrides: {bibles: ['eng_bsb', 'eng_webp'], bibles_layout: 'alternate'},
        note: 'poetry bilingual alternate pages'},
    {id: 'jhn_bi_grid', books: ['jhn'], overrides: {bibles: ['eng_bsb', 'eng_webp']},
        note: 'prose bilingual side-by-side grid'},
    {id: 'jhn_bi_alt', books: ['jhn'],
        overrides: {bibles: ['eng_bsb', 'eng_webp'], bibles_layout: 'alternate'},
        note: 'prose bilingual alternate pages'},

    // Half-blank facing pages (multi-document compile + page interleave), with/without the
    // dotted lines document
    {id: 'psa_half', books: ['psa'], overrides: {half_blank: 'right'},
        note: 'poetry with half-blank lined pages'},
    {id: 'psa_half_nolines', books: ['psa'],
        overrides: {half_blank: 'right', show_lines: false},
        note: 'poetry with half-blank plain pages'},
    {id: 'jhn_half', books: ['jhn'], overrides: {half_blank: 'right'},
        note: 'prose with half-blank lined pages'},

    // Non-Latin scripts (Noto fallback fonts, CJK line breaking)
    {id: 'psa_cmn', books: ['psa'], overrides: {bibles: ['cmn_bib']},
        note: 'poetry in Chinese'},
    {id: 'psa_kor', books: ['psa'], overrides: {bibles: ['kor_old']},
        note: 'poetry in Korean'},
    {id: 'jhn_cmn', books: ['jhn'], overrides: {bibles: ['cmn_bib']},
        note: 'prose in Chinese'},
    {id: 'jhn_kor', books: ['jhn'], overrides: {bibles: ['kor_old']},
        note: 'prose in Korean'},

    // The remedy test: if single-column collapses the poetry peak, a full Bible should fit
    // everywhere (browser cap and the 2Gi compile service)
    {id: 'full_col1', books: [...OT_BOOKS, ...NT_BOOKS], overrides: {columns: false},
        note: 'full Bible forced single column'},

    // Full Bible with untouched defaults (auto columns → 2-col poetry books + footnotes):
    // the everyday worst case users actually hit
    {id: 'full_base', books: [...OT_BOOKS, ...NT_BOOKS], overrides: {},
        note: 'full Bible defaults (auto columns)'},
]


// Resolve the configs a harness should run: all of them, or the comma-separated subset in
// STRESS_CONFIGS (unknown ids fail loudly rather than silently testing nothing)
export function get_configs():StressConfig[] {
    const env = process.env['STRESS_CONFIGS']
    if (!env){
        return MATRIX
    }
    return env.split(',').map(raw => {
        const id = raw.trim()
        const config = MATRIX.find(entry => entry.id === id)
        if (!config){
            throw new Error(`Unknown stress config: ${id}`)
        }
        return config
    })
}
