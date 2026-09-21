
// Blueprint defaults, validation and the display helpers over them.
//
// clean_blueprint() is the security-relevant one: it's what stands between a Firestore doc a
// co-editor wrote and the rest of the app. The shared zod schema is tested in the typst package;
// what's tested here is the app's own layer on top — dropping translations that no longer exist,
// and forcing booklet off for a real printing service.

import {describe, it, expect, beforeEach} from 'vitest'

import {books_ordered} from '@gracious.tech/bible-references'

import {get_default_blueprint, clean_blueprint, collect_passage_books, content_preview,
    gen_content_name, picture_story_reference, missing_book_warnings, has_missing_books,
    unit_label, format_dims, format_paper_size, format_service_label, format_pages_label,
    get_passages, default_title, font_default_for_bibles} from '@/services/blueprints'

import {reset_content, set_translations, set_books} from './stubs/content'
import {make_blueprint, make_passage, make_title, make_custom} from './helpers/blueprint'
import {echo_t as t} from './helpers/i18n'

import type {ContentPictureStory} from '@/services/types'


// One slide of a picture story
function slide(id:string, book:string|null):ContentPictureStory['slides'][number]{
    return {
        id,
        image: null,
        mode: book === null ? 'text' : 'passage',
        book: book ?? '',
        start_chapter: null,
        start_verse: null,
        end_chapter: null,
        end_verse: null,
        doc: {type: 'doc', content: []},
    }
}


// A picture story item
function make_story(id:string, books:(string|null)[]):ContentPictureStory {
    return {type: 'picture_story', id, title: null, title_subtitle: '', title_icon: null,
        slides: books.map((book, i) => slide(`s${i}`, book))}
}


beforeEach(() => {
    reset_content()
    set_translations(['eng_bsb'])
})


describe('get_default_blueprint', () => {

    it('seeds the first translation from the collection\'s preferred resource', () => {
        expect(get_default_blueprint().bibles).toEqual(['eng_bsb'])
    })

    it('starts with no name, no cover and no content', () => {
        const blueprint = get_default_blueprint()
        expect(blueprint.name).toBe('')
        expect(blueprint.cover).toBe(null)
        expect(blueprint.content).toEqual([])
    })

    it('returns a fresh object each call, so one design cannot leak into another', () => {
        const a = get_default_blueprint()
        a.content.push(make_passage('p1'))
        expect(get_default_blueprint().content).toEqual([])
    })
})


describe('clean_blueprint', () => {

    it('accepts a valid blueprint', () => {
        const blueprint = make_blueprint({font_size: 12})
        expect(clean_blueprint(blueprint).font_size).toBe(12)
    })

    it('falls back wholesale for junk', () => {
        for (const junk of [null, undefined, 'str', 42, []]){
            expect(clean_blueprint(junk).font_size).toBe(get_default_blueprint().font_size)
        }
    })

    it('drops a translation that no longer exists', () => {
        // A co-editor's doc can name a translation this client's collection doesn't have
        set_translations(['eng_bsb'])
        expect(clean_blueprint(make_blueprint({bibles: ['eng_bsb', 'gone_xyz']})).bibles)
            .toEqual(['eng_bsb'])
    })

    it('falls back to the preferred translation when every one is gone', () => {
        // Never leaves `bibles` empty — the rest of the app reads bibles[0] unconditionally
        set_translations(['eng_bsb'])
        expect(clean_blueprint(make_blueprint({bibles: ['gone_xyz']})).bibles)
            .toEqual(['eng_bsb'])
    })

    it('keeps a second translation that does exist', () => {
        set_translations(['eng_bsb', 'spa_rvr'])
        expect(clean_blueprint(make_blueprint({bibles: ['eng_bsb', 'spa_rvr']})).bibles)
            .toEqual(['eng_bsb', 'spa_rvr'])
    })

    it('forces booklet off for a real printing service', () => {
        // Fold-in-half only makes sense for self-managed printing
        expect(clean_blueprint(make_blueprint({service_id: 'lulu', booklet: true})).booklet)
            .toBe(false)
    })

    it('keeps booklet for home and custom printing', () => {
        for (const service_id of ['home', 'custom']){
            expect(clean_blueprint(make_blueprint({service_id, booklet: true})).booklet)
                .toBe(true)
        }
    })

    it('returns a deep clone, sharing no references with its input', () => {
        // ProseMirror docs pass through the schema by reference
        const custom = make_custom('c1', 'Hello')
        const cleaned = clean_blueprint(make_blueprint({content: [custom]}))
        expect(cleaned.content[0]).not.toBe(custom)
        expect(cleaned.content[0]).toEqual(custom)
    })

    it('drops an invalid content item but keeps the valid ones', () => {
        const cleaned = clean_blueprint(make_blueprint(
            {content: [make_passage('p1'), {type: 'nonsense'} as never, make_title('t1')]}))
        expect(cleaned.content.map(item => item.id)).toEqual(['p1', 't1'])
    })
})


describe('font_default_for_bibles', () => {

    it('uses Source Serif 4 for a language it covers', () => {
        set_translations(['eng_bsb'])
        expect(font_default_for_bibles(['eng_bsb'])).toBe('Source Serif 4')
    })

    it('falls back to Noto Serif when any translation is outside its coverage', () => {
        set_translations(['eng_bsb', 'khm_std'])
        expect(font_default_for_bibles(['eng_bsb', 'khm_std'])).toBe('Noto Serif')
    })

    it('guesses the language from the id when the translation is not loaded', () => {
        reset_content()
        expect(font_default_for_bibles(['eng_bsb'])).toBe('Source Serif 4')
        expect(font_default_for_bibles(['khm_std'])).toBe('Noto Serif')
    })
})


describe('collect_passage_books', () => {

    it('finds standalone passages', () => {
        expect(collect_passage_books([make_passage('p1', {book: 'gen'}),
            make_passage('p2', {book: 'exo'})])).toEqual(['gen', 'exo'])
    })

    it('finds a picture story\'s passage slides', () => {
        expect(collect_passage_books([make_story('s1', ['mat', 'mrk'])]))
            .toEqual(['mat', 'mrk'])
    })

    it('ignores a story\'s text-only slides', () => {
        expect(collect_passage_books([make_story('s1', ['mat', null])])).toEqual(['mat'])
    })

    it('deduplicates', () => {
        expect(collect_passage_books([make_passage('p1', {book: 'gen'}),
            make_passage('p2', {book: 'gen'})])).toEqual(['gen'])
    })

    it('ignores items with no scripture', () => {
        expect(collect_passage_books([make_title('t1'), make_custom('c1')])).toEqual([])
    })
})


describe('missing book warnings', () => {

    beforeEach(() => {
        set_translations(['eng_bsb'])
    })

    it('says nothing when every book is available', () => {
        set_books('eng_bsb', {gen: {available: true, ot: true}})
        expect(missing_book_warnings(['gen'], ['eng_bsb'], t)).toEqual([])
        expect(has_missing_books(['gen'], ['eng_bsb'])).toBe(false)
    })

    it('names a missing book', () => {
        set_books('eng_bsb', {gen: {available: true, ot: true, name: 'Genesis'},
            exo: {available: false, ot: true, name: 'Exodus'}})
        const warnings = missing_book_warnings(['gen', 'exo'], ['eng_bsb'], t)
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('Exodus')
        expect(has_missing_books(['gen', 'exo'], ['eng_bsb'])).toBe(true)
    })

    it('collapses a wholly unavailable testament into one label', () => {
        // Translations are commonly NT-only, and listing 39 book names would be useless
        set_books('eng_bsb', {
            gen: {available: false, ot: true, name: 'Genesis'},
            exo: {available: false, ot: true, name: 'Exodus'},
            mat: {available: true, nt: true, name: 'Matthew'},
        })
        const warnings = missing_book_warnings(['gen', 'exo', 'mat'], ['eng_bsb'], t)
        expect(warnings[0]).toContain('common.old_testament')
        expect(warnings[0]).not.toContain('Genesis')
    })

    it('names individual books when the testament is only partly missing', () => {
        set_books('eng_bsb', {
            gen: {available: true, ot: true, name: 'Genesis'},
            exo: {available: false, ot: true, name: 'Exodus'},
        })
        const warnings = missing_book_warnings(['gen', 'exo'], ['eng_bsb'], t)
        expect(warnings[0]).toContain('Exodus')
        expect(warnings[0]).not.toContain('common.old_testament')
    })

    it('warns once per translation', () => {
        set_translations(['eng_bsb', 'spa_rvr'])
        set_books('eng_bsb', {gen: {available: false, ot: true, name: 'Genesis'}})
        set_books('spa_rvr', {gen: {available: false, ot: true, name: 'Génesis'}})
        expect(missing_book_warnings(['gen'], ['eng_bsb', 'spa_rvr'], t)).toHaveLength(2)
    })

    it('says nothing about a translation whose books have not loaded yet', () => {
        reset_content()
        set_translations(['eng_bsb'])
        expect(missing_book_warnings(['gen'], ['eng_bsb'], t)).toEqual([])
        expect(has_missing_books(['gen'], ['eng_bsb'])).toBe(false)
    })
})


describe('gen_content_name', () => {

    it('names a passage by its reference, in the given translation', () => {
        expect(gen_content_name(make_passage('p1', {book: 'gen'}), 'eng_bsb'))
            .toContain('eng_bsb:gen')
    })

    it('passes the abbreviate flag through', () => {
        expect(gen_content_name(make_passage('p1'), 'eng_bsb', true)).toContain('!')
        expect(gen_content_name(make_passage('p1'), 'eng_bsb', false)).not.toContain('!')
    })

    it('names a title page by its title', () => {
        expect(gen_content_name(make_title('t1', 'Holy Bible'), 'eng_bsb')).toBe('Holy Bible')
    })

    it('names a custom page by its name when it has one', () => {
        const custom = {...make_custom('c1', 'Some body text'), name: 'Copyright'}
        expect(gen_content_name(custom, 'eng_bsb')).toBe('Copyright')
    })

    it('falls back to a custom page\'s opening words', () => {
        expect(gen_content_name(make_custom('c1', 'Some body text'), 'eng_bsb'))
            .toBe('Some body text')
    })

    it('cuts a long custom page at a word boundary', () => {
        const long = 'word '.repeat(30).trim()
        const name = gen_content_name(make_custom('c1', long), 'eng_bsb')
        expect(name.endsWith('…')).toBe(true)
        expect(name).not.toContain('wor…')
    })

    it('labels an empty custom page', () => {
        // This one label comes from the module-level translator, not a caller-supplied `t`
        expect(gen_content_name(make_custom('c1'), 'eng_bsb')).toBe('Empty')
    })

    it('names a picture story by its title, falling back to a generic label', () => {
        const story = make_story('s1', ['mat'])
        expect(gen_content_name(story, 'eng_bsb')).toBe('Picture story')
        expect(gen_content_name({...story, title: 'The Prodigal Son'}, 'eng_bsb'))
            .toBe('The Prodigal Son')
    })
})


describe('picture_story_reference', () => {

    it('spans the first to last passage slide', () => {
        expect(picture_story_reference(make_story('s1', ['mat', 'mrk']), 'eng_bsb'))
            .toContain('eng_bsb:')
    })

    it('is null for a story referencing no scripture', () => {
        expect(picture_story_reference(make_story('s1', [null, null]), 'eng_bsb')).toBe(null)
    })

    it('ignores text slides between the passage ones', () => {
        expect(picture_story_reference(make_story('s1', ['mat', null, 'mrk']), 'eng_bsb'))
            .not.toBe(null)
    })
})


describe('content_preview', () => {

    const whole_ot = books_ordered.slice(0, 39).map((book, i) => make_passage(`ot${i}`, {book}))
    const whole_nt = books_ordered.slice(39).map((book, i) => make_passage(`nt${i}`, {book}))

    it('collapses the whole canon to one label', () => {
        expect(content_preview([...whole_ot, ...whole_nt], 'eng_bsb')).toBe('Whole bible')
    })

    it('collapses a whole testament', () => {
        expect(content_preview(whole_ot, 'eng_bsb')).toBe('OT')
        expect(content_preview(whole_nt, 'eng_bsb')).toBe('NT')
    })

    it('lists both testament labels when both are complete but content is not', () => {
        // Can't happen with only whole books, so add an extra partial passage
        const preview = content_preview(
            [...whole_ot, ...whole_nt.slice(0, -1)], 'eng_bsb')
        expect(preview).toContain('OT')
    })

    it('omits title and custom pages — not what a user scans for', () => {
        expect(content_preview(
            [make_title('t1'), make_custom('c1', 'text'), make_passage('p1', {book: 'gen'})],
            'eng_bsb')).toBe('eng_bsb:gen 1')
    })

    it('does not abbreviate a single reference', () => {
        expect(content_preview([make_passage('p1', {book: 'gen'})], 'eng_bsb'))
            .not.toContain('!')
    })

    it('abbreviates once several references share the line', () => {
        const preview = content_preview(
            [make_passage('p1', {book: 'gen'}), make_passage('p2', {book: 'exo'})], 'eng_bsb')
        expect(preview).toContain('!')
        expect(preview).toContain(', ')
    })

    it('labels a fully custom picture story', () => {
        expect(content_preview([make_story('s1', [null])], 'eng_bsb')).toBe('Custom text')
    })

    it('is empty for content with no scripture at all', () => {
        expect(content_preview([make_title('t1'), make_custom('c1')], 'eng_bsb')).toBe('')
    })
})


describe('display formatting', () => {

    it('shortens the inch unit for a chip', () => {
        expect(unit_label('mm')).toBe('mm')
        expect(unit_label('inch')).toBe('in')
    })

    it('rounds millimetres but not inches', () => {
        expect(format_dims(152.4, 228.6, 'mm')).toBe('152 × 229 mm')
        expect(format_dims(6, 9, 'inch')).toBe('6 × 9 in')
    })

    it('names a known paper size with its dimensions', () => {
        const label = format_paper_size(make_blueprint({service_id: 'home', size_id: 'a4'}))
        expect(label).toContain('A4')
        expect(label).toContain('mm')
    })

    it('drops the dimensions in short form', () => {
        expect(format_paper_size(
            make_blueprint({service_id: 'home', size_id: 'a4'}), true)).toBe('A4')
    })

    it('always shows dimensions for a custom size, short form or not', () => {
        // There's no name to fall back to
        const blueprint = make_blueprint({size_id: '', custom_trim_width: 100,
            custom_trim_height: 200, custom_unit: 'mm'})
        expect(format_paper_size(blueprint, true)).toBe('100 × 200 mm')
    })

    it('falls back to the custom dimensions for a size the service does not have', () => {
        const blueprint = make_blueprint({service_id: 'home', size_id: 'not_a_size',
            custom_trim_width: 100, custom_trim_height: 200, custom_unit: 'mm'})
        expect(format_paper_size(blueprint)).toBe('100 × 200 mm')
    })

    it('labels the service-less printing modes', () => {
        expect(format_service_label({service_id: 'home', booklet: true}, t))
            .toBe('common.booklet_home')
        expect(format_service_label({service_id: 'home', booklet: true}, t, true))
            .toBe('common.booklet')
        expect(format_service_label({service_id: 'home', booklet: false}, t)).toBe('common.home')
        expect(format_service_label({service_id: 'custom', booklet: false}, t))
            .toBe('common.custom_menu')
    })

    it('uses a real service\'s own name', () => {
        expect(format_service_label({service_id: 'lulu', booklet: false}, t)).toBe('Lulu')
    })

    describe('page counts', () => {

        it('is null before anything has rendered', () => {
            expect(format_pages_label(null, false, t)).toBe(null)
        })

        it('reports a plain page count for a normal book', () => {
            expect(format_pages_label(120, false, t)).toBe('svc.blueprint.pages.other(n=120)')
        })

        it('uses the singular for one page', () => {
            expect(format_pages_label(1, false, t)).toBe('svc.blueprint.pages.one(n=1)')
        })

        it('doubles a booklet\'s stored sheet-side count back to reader pages', () => {
            // Booklets store the imposed sheet-side count, two content pages per side
            const label = format_pages_label(10, true, t)
            expect(label).toContain('pages.other(n=20)')
            expect(label).toContain('sheets.other(n=5)')
        })

        it('rounds a booklet\'s sheet count up', () => {
            expect(format_pages_label(9, true, t)).toContain('sheets.other(n=5)')
        })
    })
})


describe('get_passages and default_title', () => {

    it('picks out only the passage items', () => {
        expect(get_passages(make_blueprint({content: [make_title('t1'),
            make_passage('p1'), make_custom('c1')]})).map(item => item.id)).toEqual(['p1'])
    })

    it('uses the design\'s name when it has one', () => {
        expect(default_title(make_blueprint({name: '  Family Bible  '}))).toBe('Family Bible')
    })

    it('falls back to the first passage\'s reference', () => {
        expect(default_title(make_blueprint(
            {name: '', content: [make_passage('p1', {book: 'tit'})]})))
            .toContain('eng_bsb:tit')
    })

    it('is empty with no name and no passages', () => {
        expect(default_title(make_blueprint({name: '', content: []}))).toBe('')
    })
})
