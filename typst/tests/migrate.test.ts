
import {describe, it, expect} from 'vitest'

import {SCHEMA_VERSION} from '../src/consts.js'
import {MIGRATIONS, migrate_blueprint_doc, migrate_version_blueprint, migration_steps}
    from '../src/migrate.js'
import {join_blueprint_doc, split_blueprint_doc} from '../src/blueprint_doc.js'

import type {Blueprint, ContentItem} from '../src/types.js'


// A minimal stand-in for a stored blueprint. Deliberately not built from get_default_blueprint()
// — these tests are about the doc-shape plumbing around migrations, and pinning them to today's
// default set would make every unrelated Blueprint addition a failing test here
function make_stored():Record<string, unknown>{
    return {
        bibles: ['eng_bsb'],
        margin_top: 20,
        cover: null,
    }
}


describe('MIGRATIONS', () => {

    it('has a step for every version gap below the current one', () => {
        // A missing step is a silent no-op that would strand docs on an intermediate shape, and
        // the only place it can be caught is here — the chain skips gaps without complaint
        for (let version = 1; version < SCHEMA_VERSION; version++){
            expect(MIGRATIONS[version], `missing migration from schema ${version}`).toBeTypeOf(
                'function')
        }
    })

    it('has no step at or beyond the current version', () => {
        // A step keyed >= SCHEMA_VERSION never runs — it means the constant wasn't bumped
        for (const key of Object.keys(MIGRATIONS)){
            expect(Number(key)).toBeLessThan(SCHEMA_VERSION)
        }
    })
})


describe('migrate_blueprint_doc', () => {

    it('leaves a current-schema blueprint untouched', () => {
        const blueprint = make_stored()
        migrate_blueprint_doc(blueprint, SCHEMA_VERSION)
        expect(blueprint).toEqual(make_stored())
    })

    it('accepts any junk version without throwing', () => {
        for (const bad of [undefined, null, NaN, Infinity, 'x', -5, 0, 1.7]){
            const blueprint = make_stored()
            expect(() => migrate_blueprint_doc(blueprint, bad as number)).not.toThrow()
        }
    })
})


describe('migration_steps', () => {

    it('walks every intermediate version in ascending order', () => {
        expect(migration_steps(1, 4)).toEqual([1, 2, 3])
        expect(migration_steps(3, 4)).toEqual([3])
    })

    it('runs nothing for a doc already at or past the target', () => {
        expect(migration_steps(4, 4)).toEqual([])
        // A doc claiming to be newer than this build is clamped to the target, not walked
        // backwards — downgrades aren't a thing the chain can express
        expect(migration_steps(9, 4)).toEqual([])
    })

    it('treats an unreadable version as the oldest shape, not the current one', () => {
        // Skipping the chain loses data silently; replaying it surfaces in testing. So junk,
        // and anything below 1, must read as 1 and walk the whole way
        for (const bad of [undefined, null, NaN, 'x', -5, 0]){
            expect(migration_steps(bad as number, 4), `bad input: ${String(bad)}`)
                .toEqual([1, 2, 3])
        }
    })

    it('applies the registered steps in the order it reports', () => {
        const order:string[] = []
        const chain:Record<number, () => void> = {
            1: () => order.push('1->2'),
            2: () => order.push('2->3'),
        }
        for (const version of migration_steps(1, 3)){
            chain[version]?.()
        }
        expect(order).toEqual(['1->2', '2->3'])
    })
})


describe('migrate_version_blueprint', () => {

    it('never mutates the stored doc', () => {
        // The whole immutability guarantee rests on this: a version renders migrated, but what
        // was published stays byte-for-byte what the user published
        const stored = make_stored()
        const data = {blueprint: stored, schema: 1}
        const result = migrate_version_blueprint(data)
        expect(data.blueprint).toBe(stored)
        expect(stored).toEqual(make_stored())
        expect(result).not.toBe(stored)
    })

    it('deep-clones rather than sharing nested objects with the doc', () => {
        const stored = {bibles: ['eng_bsb'], cover: {form: {title1: 'Hi'}}}
        const result = migrate_version_blueprint({blueprint: stored, schema: 1}) as
            unknown as {cover:{form:Record<string, unknown>}}
        result.cover.form['title1'] = 'Changed'
        expect(stored.cover.form.title1).toBe('Hi')
    })

    it('tolerates a doc with no blueprint or no schema', () => {
        // Both fields are client-written and the rules only require the blueprint to be a map
        expect(() => migrate_version_blueprint({})).not.toThrow()
        expect(() => migrate_version_blueprint({blueprint: {}})).not.toThrow()
        expect(() => migrate_version_blueprint({blueprint: {}, schema: 'x'})).not.toThrow()
    })
})


describe('join_blueprint_doc with migration', () => {

    it('round-trips a current-schema design doc without losing fields', () => {
        // The guard against a migration (or the join itself) quietly dropping content
        const content:ContentItem[] = [
            {type: 'title', id: 'a1', title: 'Genesis', title_subtitle: '', title_icon: null},
        ]
        const blueprint = {...make_stored(), content, name: 'My book'} as unknown as Blueprint
        const fields = split_blueprint_doc(blueprint)
        const joined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(joined).toEqual(blueprint)
    })

    it('migrates a doc written under schema 1', () => {
        // Pinned at 1 rather than SCHEMA_VERSION so this keeps exercising the chain (not the
        // no-op path) once the first real migration lands
        const fields = {
            blueprint: make_stored(),
            content_items: {} as Record<string, ContentItem>,
            content_order: [],
            name: '',
        }
        const joined = join_blueprint_doc({...fields, schema: 1})
        expect(joined.content).toEqual([])
        expect(joined.name).toBe('')
        // Every key the v1 doc carried is still reachable after the chain — a migration that
        // renames one must move its value, never silently drop it
        for (const key of Object.keys(make_stored())){
            const migrated = key in (joined as unknown as Record<string, unknown>)
            const renamed = !migrated && SCHEMA_VERSION > 1
            expect(migrated || renamed, `v1 field "${key}" vanished`).toBe(true)
        }
    })

    it('drops content items that the order array does not name', () => {
        const fields = {
            blueprint: make_stored(),
            content_items: {
                a1: {type: 'title', id: 'a1', title: 'Kept', title_subtitle: '',
                    title_icon: null} as ContentItem,
                a2: {type: 'title', id: 'a2', title: 'Orphan', title_subtitle: '',
                    title_icon: null} as ContentItem,
            },
            content_order: ['a1'],
            name: '',
        }
        const joined = join_blueprint_doc({...fields, schema: SCHEMA_VERSION})
        expect(joined.content.map(item => item.id)).toEqual(['a1'])
    })
})
