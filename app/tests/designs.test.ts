// The design sync (designs.ts): edits leave as field-level diffs, so co-editors working on
// different fields or items never overwrite each other; snapshots of our own pending writes are
// ignored, and a co-editor's are merged three-way into unsaved local edits; a design read under an
// older schema converges with one wholesale write; a stalled or refused write is surfaced through
// `health`; and the list, deletion, renames, sharing and the read-access list do what they say.
// Firestore is an in-memory fake that records writes and lets each test deliver snapshots

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {nextTick} from 'vue'
import {cloneDeep} from 'lodash-es'
import {split_blueprint_doc, COVER_TITLE_KEY, SCHEMA_VERSION} from 'paper-bible-typst'

import {make_blueprint, make_passage} from './helpers/blueprint'

import type {Blueprint, CoverConfig} from '@/services/types'


// A Firestore stand-in: refs are their paths, writes are recorded, and listeners are held so a
// test can deliver the snapshots it wants (including echoes of pending writes)
const fs = vi.hoisted(() => {

    // A delete sentinel, an arrayRemove, and a server timestamp, as readable values
    const DELETE = {op: 'delete'}
    const SERVER_TS = {op: 'server_timestamp'}

    class FieldPath {
        segments:string[]
        constructor(...segments:string[]){
            this.segments = segments
        }
    }

    class Timestamp {
        ms:number
        constructor(ms:number){
            this.ms = ms
        }
        static now(){
            return new Timestamp(Date.now())
        }
        static fromMillis(ms:number){
            return new Timestamp(ms)
        }
        toDate(){
            return new Date(this.ms)
        }
    }

    type Listener = {next:(snap:unknown) => void, error:(error:unknown) => void}

    const state = {
        // Live listeners by ref key (a doc's path, or `query:<collection path>`)
        listeners: new Map<string, Listener>(),
        // Every write, as [kind, path, field/value pairs]
        writes: [] as [string, string, [string, unknown][]][],
        // Docs getDoc() reads
        stored: new Map<string, Record<string, unknown>>(),
        // What the next updateDoc() resolves or rejects with (null = resolve at once)
        update_result: null as null|(() => Promise<void>),
    }

    // A ref's key in `listeners`
    const key_of = (ref:unknown) => typeof ref === 'string' ? ref
        : `query:${(ref as {collection:string}).collection}`

    // An update's arguments as [field, value] pairs, field paths dotted
    const pairs = (args:unknown[]):[string, unknown][] => {
        if (args.length === 1){
            return Object.entries(args[0] as Record<string, unknown>)
        }
        const result:[string, unknown][] = []
        for (let i = 0; i < args.length; i += 2){
            const field = args[i]
            result.push([field instanceof FieldPath ? field.segments.join('.') : field as string,
                args[i + 1]])
        }
        return result
    }

    const module = {
        FieldPath,
        Timestamp,
        doc: (_db:unknown, ...segments:string[]) => segments.join('/'),
        collection: (_db:unknown, ...segments:string[]) => ({collection: segments.join('/')}),
        query: (collection:{collection:string}, ...constraints:unknown[]) =>
            ({...collection, constraints}),
        where: (...args:unknown[]) => ['where', ...args],
        orderBy: (...args:unknown[]) => ['orderBy', ...args],
        deleteField: () => DELETE,
        arrayRemove: (value:unknown) => ({op: 'array_remove', value}),
        serverTimestamp: () => SERVER_TS,
        onSnapshot: (ref:unknown, next:Listener['next'], error:Listener['error']) => {
            const key = key_of(ref)
            const listener = {next, error}
            state.listeners.set(key, listener)
            return () => {
                if (state.listeners.get(key) === listener){
                    state.listeners.delete(key)
                }
            }
        },
        getDoc: async (path:string) => {
            const data = state.stored.get(path)
            return {exists: () => !!data, data: () => data}
        },
        setDoc: async (path:string, data:Record<string, unknown>) => {
            state.writes.push(['set', path, Object.entries(data)])
            state.stored.set(path, data)
        },
        updateDoc: async (path:string, ...args:unknown[]) => {
            state.writes.push(['update', path, pairs(args)])
            if (state.update_result){
                await state.update_result()
            }
        },
        deleteDoc: async (path:string) => {
            state.writes.push(['delete', path, []])
        },
        writeBatch: () => {
            const batched:[string, string, [string, unknown][]][] = []
            return {
                update: (path:string, data:Record<string, unknown>) => {
                    batched.push(['batch', path, Object.entries(data)])
                },
                commit: async () => {
                    state.writes.push(...batched)
                },
            }
        },
    }

    return {state, module, DELETE, SERVER_TS}
})
vi.mock('firebase/firestore', () => fs.module)
vi.mock('@/services/firebase', () => ({firestore: {}}))

// The collaborators: the API, who's signed in, error reports, and the font/asset/wizard plumbing
const mocks = vi.hoisted(() => ({
    api: vi.fn(async (..._args:unknown[]):Promise<unknown> => ({ok: true})),
    report_error: vi.fn(),
    load_design_fonts: vi.fn(async (..._args:unknown[]) => undefined),
    clear_design_fonts: vi.fn(),
    rehydrate: vi.fn(async (blueprint:unknown, _id:string) => blueprint),
    build_new_blueprint: vi.fn(),
    welcome_seen: false,
}))
vi.mock('@/services/api', () => ({api: mocks.api}))
vi.mock('@/services/auth', () => ({signed_in_user: async () => ({uid: 'u1'})}))
vi.mock('@/services/errors', () => ({report_error: mocks.report_error}))
vi.mock('@/services/custom_fonts', () => ({
    load_design_fonts: mocks.load_design_fonts,
    clear_design_fonts: mocks.clear_design_fonts,
}))
vi.mock('@/services/version_assets', () => ({rehydrate_version_blueprint: mocks.rehydrate}))
vi.mock('@/services/new_design', async importOriginal => ({
    ...await importOriginal<object>(),
    build_new_blueprint: mocks.build_new_blueprint,
}))
// What the real new_design.ts reaches for at import (rendering and the worker), unused here
vi.mock('@/services/cover', () => ({}))
vi.mock('@/services/typst', () => ({typst_generator: {value: null}}))
vi.mock('@/services/stories', () => ({}))
vi.mock('@/services/utils', async importOriginal => ({
    ...await importOriginal<object>(),
    generate_token: () => `token_${++token_count}`,
}))

// The real module has no health/welcome tracking in the stub, so they're added here
vi.mock('@/services/state', async importOriginal => {
    const {reactive} = await import('vue')
    return {
        ...await importOriginal<object>(),
        health: reactive({saving: null as null|string, engine_failed: false}),
        welcome_seen: () => mocks.welcome_seen,
    }
})


// Tokens are numbered so a test can tell a fresh one from an old one
let token_count = 0


// A fresh copy of the module (it keeps the open design, sync base and listeners at module level),
// with the state double it shares
async function load(){
    vi.resetModules()
    const content = await import('@/services/content') as unknown as typeof import('./stubs/content')
    content.reset_content()
    content.set_translations(['eng_bsb', 'eng_web'])
    const state = await import('@/services/state') as unknown as typeof import('./stubs/state')
        & {health:{saving:string|null}}
    const designs = await import('@/services/designs')
    return {designs, state, blue: state.blue}
}


// A design doc as Firestore holds it, from a blueprint
function design_doc(blueprint:Blueprint, extra:Record<string, unknown> = {}){
    return {
        schema: SCHEMA_VERSION, owner: 'u1', editor_uids: ['u1'], save_token: 'saved',
        name_auto: '', share_token: 'share', category: null, latest_version: null,
        ...split_blueprint_doc(cloneDeep(blueprint)),
        ...extra,
    }
}


// Deliver a doc snapshot to the listener on `path` (null = the doc was deleted)
function emit_doc(path:string, data:Record<string, unknown>|null, pending = false):void{
    const listener = fs.state.listeners.get(path)
    if (!listener){
        throw new Error(`Nothing is listening to ${path}`)
    }
    listener.next({exists: () => data !== null, data: () => cloneDeep(data),
        metadata: {hasPendingWrites: pending}})
}


// Deliver a query snapshot of [id, data] docs to the listener on a collection
function emit_query(collection:string, docs:[string, Record<string, unknown>][]):void{
    fs.state.listeners.get(`query:${collection}`)!.next({
        empty: docs.length === 0,
        docs: docs.map(([id, data]) => ({id, data: () => data})),
    })
}


// Boot the designs list, waiting for its listener (a fresh one each boot) before handing back
// the boot itself (wrapped, as returning it bare would wait for it here)
async function boot(designs:typeof import('@/services/designs'), open_id:string|null = null,
        welcome = true):Promise<{done:Promise<void>}>{
    fs.state.listeners.delete('query:designs')
    const done = designs.init_designs(open_id, welcome)
    await vi.waitFor(() => expect(fs.state.listeners.has('query:designs')).toBe(true))
    return {done}
}


// Open a design whose doc holds `blueprint`, delivering its first snapshot
async function open(designs:typeof import('@/services/designs'), blueprint:Blueprint,
        id = 'd1', extra:Record<string, unknown> = {}):Promise<void>{
    const opening = designs.open_design(id)
    emit_doc(`designs/${id}`, design_doc(blueprint, extra))
    await opening
}


// The field/value pairs of the updates written to a doc, last first
function updates_to(path:string):[string, unknown][][]{
    return fs.state.writes.filter(([kind, at]) => kind === 'update' && at === path)
        .map(([, , fields]) => fields).reverse()
}

// The fields of the last update to a doc, by name
function last_update(path = 'designs/d1'):Record<string, unknown>{
    return Object.fromEntries(updates_to(path)[0] ?? [])
}


beforeEach(() => {
    fs.state.listeners.clear()
    fs.state.writes = []
    fs.state.stored.clear()
    fs.state.update_result = null
    mocks.welcome_seen = false
    token_count = 0
    for (const mock of [mocks.api, mocks.report_error, mocks.load_design_fonts,
            mocks.clear_design_fonts, mocks.rehydrate, mocks.build_new_blueprint]){
        mock.mockClear()
    }
})

afterEach(() => {
    vi.useRealTimers()
})


describe('opening a design', () => {

    // The first snapshot is the whole design; its assets are stamped as in use once a session
    it('mirrors the doc into blue and stamps its assets once', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({show_verses: false,
            content: [make_passage('p1')]}), 'd1', {fonts: {f: {family: 'Lora'}}})
        expect(blue.show_verses).toBe(false)
        expect(blue.content.map(item => item.id)).toEqual(['p1'])
        expect(designs.current_design_id.value).toBe('d1')
        expect(mocks.load_design_fonts).toHaveBeenCalledWith({f: {family: 'Lora'}})
        expect(mocks.clear_design_fonts).toHaveBeenCalled()

        // Reopening in the same session doesn't stamp again
        await open(designs, make_blueprint(), 'd2')
        await open(designs, make_blueprint(), 'd1')
        expect(mocks.api.mock.calls.filter(call => call[0] === '/api/touch_assets')
            .map(call => call[1])).toEqual([{design_id: 'd1'}, {design_id: 'd2'}])
    })

    // The wizard's state travels beside the blueprint, validated on the way in
    it('reads the wizard state, which needs a draft to be simple', async () => {
        const {designs} = await load()
        await open(designs, make_blueprint(), 'd1', {simple_mode: true, wizard_draft: null})
        expect(designs.design_wizard.simple_mode).toBe(false)
    })

    // A failed font download is only reported, never fails the open
    it('reports a design\'s fonts failing to load without failing the open', async () => {
        const {designs} = await load()
        mocks.load_design_fonts.mockRejectedValueOnce(new Error('no bytes'))
        await open(designs, make_blueprint())
        await Promise.resolve()
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {context: {stage: 'design_fonts'}})
    })

    // Before the first snapshot, a listener error rejects the open for the caller to handle
    it('rejects when the listener fails before the design arrives', async () => {
        const {designs, state} = await load()
        const opening = designs.open_design('d1')
        fs.state.listeners.get('designs/d1')!.error(new Error('permission-denied'))
        await expect(opening).rejects.toThrow('permission-denied')
        expect(state.health.saving).toBe(null)
    })

    // Once open, a dead listener means edits are being refused too
    it('flags saving as failed when the listener dies after opening', async () => {
        const {designs, state} = await load()
        await open(designs, make_blueprint())
        fs.state.listeners.get('designs/d1')!.error(new Error('permission-denied'))
        expect(state.health.saving).toBe('failed')
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {critical: true, context: {listener: 'design_doc'}})
    })

    // A co-editor (or another tab) deleting the open design closes it here
    it('closes the design when its doc is deleted elsewhere', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({show_verses: false}))
        emit_doc('designs/d1', null)
        expect(designs.current_design_id.value).toBe(null)
        // blue is left holding a default design, so watchers dereferencing it stay safe
        expect(blue.show_verses).toBe(true)
        expect(fs.state.listeners.has('designs/d1')).toBe(false)
    })

    // A deep link to a design that no longer exists resolves rather than hanging
    it('resolves for a design that doesn\'t exist', async () => {
        const {designs} = await load()
        const opening = designs.open_design('gone')
        emit_doc('designs/gone', null)
        await opening
        expect(designs.current_design_id.value).toBe(null)
    })

})


describe('saving edits', () => {

    // Only what changed is written, so a co-editor's other fields survive
    it('writes only the changed options, with a fresh save_token', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({content: [make_passage('p1')]}))
        blue.show_verses = false
        blue.running_pages = !blue.running_pages
        await designs.flush_changes()
        const update = last_update()
        expect(Object.keys(update).sort()).toEqual(
            ['blueprint.running_pages', 'blueprint.show_verses', 'modified', 'save_token'])
        expect(update['blueprint.show_verses']).toBe(false)
        expect(update['modified']).toBe(fs.SERVER_TS)
        expect(update['save_token']).toBe('token_1')
    })

    // Nothing changed, nothing written — merely viewing a design never bumps `modified`
    it('writes nothing when nothing changed', async () => {
        const {designs} = await load()
        await open(designs, make_blueprint())
        await designs.flush_changes()
        await designs.flush_changes()
        expect(updates_to('designs/d1')).toEqual([])
    })

    // A rename isn't a render change, so existing versions don't read as out of date
    it('writes a rename without a new save_token', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        blue.name = 'Psalms for Mum'
        await designs.flush_changes()
        expect(Object.keys(last_update()).sort()).toEqual(['modified', 'name'])
    })

    // Content items are written whole, one field each, by FieldPath since ids contain url64
    it('writes changed, added and removed items by id, and the order only if it moved',
            async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({content: [make_passage('a-1'), make_passage('b_2'),
            make_passage('c~3')]}))

        // An edit to one item writes only that item
        blue.content[1] = make_passage('b_2', {book: 'exo'})
        await designs.flush_changes()
        expect(Object.keys(last_update()).sort()).toEqual(
            ['content_items.b_2', 'modified', 'save_token'])
        expect(last_update()['content_items.b_2']).toMatchObject({book: 'exo'})

        // Removing one deletes its field and rewrites the order
        blue.content.splice(2, 1)
        await designs.flush_changes()
        expect(last_update()['content_items.c~3']).toBe(fs.DELETE)
        expect(last_update()['content_order']).toEqual(['a-1', 'b_2'])

        // A reorder is the order alone
        blue.content.reverse()
        await designs.flush_changes()
        expect(Object.keys(last_update()).sort()).toEqual(
            ['content_order', 'modified', 'name_auto', 'save_token'])
    })

    // The derived name only moves with the first item or the primary translation
    it('recomputes name_auto only when the first item or main Bible changes', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({content: [make_passage('p1'), make_passage('p2')]}))
        blue.content[1] = make_passage('p2', {book: 'exo'})
        await designs.flush_changes()
        expect(last_update()).not.toHaveProperty('name_auto')

        blue.content[0] = make_passage('p1', {title: 'Creation'})
        await designs.flush_changes()
        expect(last_update()['name_auto']).toBe('Creation')

        blue.bibles = ['eng_web']
        blue.content[0] = make_passage('p1', {book: 'rut'})
        await designs.flush_changes()
        expect(last_update()['name_auto']).toBe('eng_web:rut 1')
    })

    // Nothing is written with no design open
    it('writes nothing while no design is open', async () => {
        const {designs, blue} = await load()
        blue.show_verses = false
        await designs.flush_changes()
        expect(fs.state.writes).toEqual([])
    })

    // A refused write is the one problem retrying won't fix, so the user is told
    it('flags a refused write and re-diffs everything on the next flush', async () => {
        const {designs, blue, state} = await load()
        await open(designs, make_blueprint())
        fs.state.update_result = () => Promise.reject(new Error('permission-denied'))
        blue.show_verses = false
        await designs.flush_changes()
        expect(state.health.saving).toBe('failed')
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {critical: true, context: {stage: 'design_flush'}})

        // The sync base went back, so the lost edit goes out again with the next one
        fs.state.update_result = null
        blue.running_pages = !blue.running_pages
        await designs.flush_changes()
        expect(Object.keys(last_update())).toEqual(expect.arrayContaining(
            ['blueprint.show_verses', 'blueprint.running_pages']))
        expect(state.health.saving).toBe(null)
    })

    // A design closed meanwhile (deleted by a co-editor) has nothing left to save
    it('doesn\'t flag a refused write for a design that has since closed', async () => {
        const {designs, blue, state} = await load()
        await open(designs, make_blueprint())
        let refuse = () => {}
        fs.state.update_result = () => new Promise((_resolve, reject) => {
            refuse = () => reject(new Error('not-found'))
        })
        blue.show_verses = false
        const flushing = designs.flush_changes()
        await Promise.resolve()
        emit_doc('designs/d1', null)
        refuse()
        await flushing
        expect(state.health.saving).toBe(null)
    })

    // Firestore queues writes while offline rather than failing them, so a long wait is the sign
    it('flags a write left unacknowledged as offline, and clears it once it lands',
            async () => {
        const {designs, blue, state} = await load()
        await open(designs, make_blueprint())
        vi.useFakeTimers()
        let land = () => {}
        fs.state.update_result = () => new Promise(resolve => {
            land = resolve
        })
        blue.show_verses = false
        const flushing = designs.flush_changes()
        await vi.advanceTimersByTimeAsync(9_000)
        expect(state.health.saving).toBe(null)
        await vi.advanceTimersByTimeAsync(2_000)
        expect(state.health.saving).toBe('offline')
        land()
        await flushing
        expect(state.health.saving).toBe(null)
    })

    // Edits are batched while typing, then written once
    it('autosaves edits once they pause', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        vi.useFakeTimers()
        designs.start_design_sync()
        blue.show_verses = false
        await nextTick()
        await vi.advanceTimersByTimeAsync(1_000)
        blue.running_pages = !blue.running_pages
        await nextTick()
        await vi.advanceTimersByTimeAsync(1_000)
        expect(updates_to('designs/d1')).toEqual([])
        await vi.advanceTimersByTimeAsync(600)
        expect(updates_to('designs/d1')).toHaveLength(1)
        expect(Object.keys(last_update())).toEqual(expect.arrayContaining(
            ['blueprint.show_verses', 'blueprint.running_pages']))
    })

    // Switching designs writes the one being left before letting go of it
    it('flushes pending edits of the design being left', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        designs.start_design_sync()
        blue.show_verses = false
        await nextTick()
        const opening = designs.open_design('d2')
        await Promise.resolve()
        expect(last_update('designs/d1')).toHaveProperty('blueprint.show_verses', false)
        emit_doc('designs/d2', design_doc(make_blueprint()))
        await opening
    })

})


describe('a design read under an older schema', () => {

    // The migration happens on read; the doc only converges once there's a real edit, and then
    // wholesale, since a field-level diff couldn't drop the keys a rename left behind
    it('converges with one wholesale write on the first edit, then diffs again', async () => {
        const {designs, blue} = await load()
        const old = design_doc(make_blueprint(), {schema: 1})
        const old_blueprint = old.blueprint as Record<string, unknown>
        delete old_blueprint['lines']
        old_blueprint['show_lines'] = true
        const opening = designs.open_design('d1')
        emit_doc('designs/d1', old)
        await opening
        expect(blue.lines).toBe('wide')

        // Opening alone writes nothing
        await designs.flush_changes()
        expect(updates_to('designs/d1')).toEqual([])

        blue.show_verses = false
        await designs.flush_changes()
        const upgrade = last_update()
        expect(upgrade['schema']).toBe(SCHEMA_VERSION)
        const written = upgrade['blueprint'] as Record<string, unknown>
        expect(written['lines']).toBe('wide')
        expect(written['show_verses']).toBe(false)
        expect(written).not.toHaveProperty('show_lines')
        expect(Object.keys(upgrade)).toEqual(expect.arrayContaining(
            ['content_items', 'content_order', 'name']))

        blue.running_pages = !blue.running_pages
        await designs.flush_changes()
        expect(Object.keys(last_update()).sort()).toEqual(
            ['blueprint.running_pages', 'modified', 'save_token'])
    })

    // A refused upgrade is attempted again rather than forgotten
    it('retries the wholesale write after a refused one', async () => {
        const {designs, blue} = await load()
        const opening = designs.open_design('d1')
        emit_doc('designs/d1', design_doc(make_blueprint(), {schema: 1}))
        await opening
        fs.state.update_result = () => Promise.reject(new Error('unavailable'))
        blue.show_verses = false
        await designs.flush_changes()
        fs.state.update_result = null
        blue.running_pages = !blue.running_pages
        await designs.flush_changes()
        expect(last_update()['schema']).toBe(SCHEMA_VERSION)
    })

})


describe('changes from co-editors', () => {

    // Our own writes come back first as pending echoes; applying them could undo newer edits
    it('ignores snapshots of pending writes', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        blue.running_pages = !blue.running_pages
        emit_doc('designs/d1', design_doc(make_blueprint({show_verses: false})), true)
        expect(blue.show_verses).toBe(true)
        expect(blue.booklet).toBe(true)
    })

    // A co-editor's change to one option arrives without undoing ours to another
    it('merges a remote option change into unsaved local edits', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        blue.running_pages = !blue.running_pages
        emit_doc('designs/d1', design_doc(make_blueprint({show_verses: false})))
        expect(blue.show_verses).toBe(false)
        expect(blue.booklet).toBe(true)

        // And only ours is still to be written
        await designs.flush_changes()
        expect(Object.keys(last_update()).sort()).toEqual(
            ['blueprint.running_pages', 'modified', 'save_token'])
    })

    // Both editing the same option: the remote value wins (last write wins)
    it('takes the remote value when both changed the same option', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        blue.show_chapters_style = 'float'
        emit_doc('designs/d1', design_doc(make_blueprint({show_chapters_style: 'heading'})))
        expect(blue.show_chapters_style).toBe('heading')
    })

    // Items are merged one by one: theirs where they changed it, ours elsewhere, and items we
    // added and haven't saved yet are kept
    it('merges content item by item, keeping unsaved local additions', async () => {
        const {designs, blue} = await load()
        const base = make_blueprint({content: [make_passage('a'), make_passage('b')]})
        await open(designs, base)

        // Locally: edit a, add c. Remotely: edit b, add d
        blue.content[0] = make_passage('a', {book: 'exo'})
        blue.content.push(make_passage('c', {book: 'lev'}))
        emit_doc('designs/d1', design_doc({...base, content: [make_passage('a'),
            make_passage('b', {book: 'num'}), make_passage('d', {book: 'deu'})]}))

        expect(blue.content.map(item => [item.id, (item as {book:string}).book])).toEqual([
            ['a', 'exo'], ['b', 'num'], ['d', 'deu'], ['c', 'lev']])
    })

    // An item a co-editor deleted goes, even if we still had it
    it('drops an item a co-editor removed', async () => {
        const {designs, blue} = await load()
        const base = make_blueprint({content: [make_passage('a'), make_passage('b')]})
        await open(designs, base)
        emit_doc('designs/d1', design_doc({...base, content: [make_passage('b')]}))
        expect(blue.content.map(item => item.id)).toEqual(['b'])
    })

})


describe('creating, deleting and restoring', () => {

    // A new design is the user's own, with fresh tokens, and opens straight away
    it('creates a design from a blueprint and opens it', async () => {
        const {designs, blue} = await load()
        const creating = designs.create_design(make_blueprint({show_verses: false,
            content: [make_passage('p1')]}), {} as never, false)
        await vi.waitFor(() => expect(fs.state.listeners.size).toBe(1))
        const [kind, path, fields] = fs.state.writes[0]!
        expect(kind).toBe('set')
        const data = Object.fromEntries(fields)
        expect(data).toMatchObject({schema: SCHEMA_VERSION, owner: 'u1', editor_uids: ['u1'],
            name_auto: 'eng_bsb:gen 1', category: null, latest_version: null, simple_mode: false})
        expect((data['blueprint'] as Record<string, unknown>)['show_verses']).toBe(false)
        emit_doc(path, data)
        expect(await creating).toBe(path.split('/')[1])
        expect(blue.show_verses).toBe(false)
    })

    // Wizard fields are only stored for a design the wizard made
    it('stores no wizard fields for a design made without the wizard', async () => {
        const {designs} = await load()
        void designs.create_design()
        await vi.waitFor(() => expect(fs.state.writes).toHaveLength(1))
        const data = Object.fromEntries(fs.state.writes[0]![2])
        expect(data).not.toHaveProperty('simple_mode')
        expect(data).not.toHaveProperty('wizard_draft')
    })

    // Deleting is the server's job; the design closes only once it has happened
    it('deletes through the server, then closes the open design', async () => {
        const {designs} = await load()
        await open(designs, make_blueprint())
        let finish = () => {}
        mocks.api.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => resolve({ok: true})
        }))
        const deleting = designs.delete_design('d1')

        // The listener hearing of it first doesn't race the delete's own teardown
        emit_doc('designs/d1', null)
        expect(designs.current_design_id.value).toBe('d1')
        finish()
        await deleting
        expect(mocks.api).toHaveBeenCalledWith('/api/delete_design', {design_id: 'd1'})
        expect(designs.current_design_id.value).toBe(null)
    })

    // A failed delete leaves the design open, its pending edits still on their way
    it('keeps the design open, autosave included, when the delete fails', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        vi.useFakeTimers()
        designs.start_design_sync()
        blue.show_verses = false
        await nextTick()
        mocks.api.mockRejectedValueOnce(new Error('offline'))
        await expect(designs.delete_design('d1')).rejects.toThrow('offline')
        expect(designs.current_design_id.value).toBe('d1')
        await vi.advanceTimersByTimeAsync(2_000)
        expect(last_update()).toHaveProperty('blueprint.show_verses', false)
    })

    // Deleting a design that isn't open touches nothing local
    it('deletes a closed design without closing the open one', async () => {
        const {designs} = await load()
        await open(designs, make_blueprint())
        await designs.delete_design('other')
        expect(designs.current_design_id.value).toBe('d1')
    })

    // Restoring replaces the content but keeps the design's name, and the restored version
    // becomes the summary the designs list reports against
    it('restores a version\'s content into the design, keeping its name', async () => {
        const {designs} = await load()
        const blueprint = make_blueprint({name: 'Old name', show_verses: false,
            content: [make_passage('p1', {book: 'jhn'})]})
        await designs.restore_version_into_design('d1',
            {blueprint, save_token: 'v_token', status: 'available', pages: 12})
        expect(mocks.rehydrate).toHaveBeenCalledWith(blueprint, 'd1')
        const update = last_update()
        expect(update).not.toHaveProperty('name')
        expect(update['save_token']).toBe('v_token')
        expect(update['name_auto']).toBe('eng_bsb:jhn 1')
        expect(update['latest_version']).toEqual(
            {status: 'available', pages: 12, save_token: 'v_token'})
        expect((update['blueprint'] as Record<string, unknown>)['show_verses']).toBe(false)
    })

    // A version forked into a design points at the design's own copies of its assets
    it('creates a design from a version, then repoints it at its own assets', async () => {
        const {designs, blue} = await load()
        mocks.rehydrate.mockImplementationOnce(async blueprint => ({
            ...(blueprint as Blueprint), show_headings: false}))
        const creating = designs.create_design_from_version({
            blueprint: make_blueprint({content: [make_passage('p1')]}), wizard_draft: null,
            simple_mode: false})
        await vi.waitFor(() => expect(fs.state.writes).toHaveLength(1))
        const [, path, fields] = fs.state.writes[0]!
        emit_doc(path, Object.fromEntries(fields))
        await creating
        expect(blue.show_headings).toBe(false)
        expect(last_update(path)).toHaveProperty('blueprint.show_headings', false)
    })

    // Duplicating is server-side; it opens the copy once the list has it
    it('duplicates through the server and opens the copy', async () => {
        const {designs} = await load()
        await boot(designs)
        emit_query('designs', [])
        mocks.api.mockResolvedValueOnce({design_id: 'copy'})
        const duplicating = designs.duplicate_design('d1')
        await vi.waitFor(() => expect(mocks.api).toHaveBeenCalled())
        emit_query('designs', [['copy', design_doc(make_blueprint())]])
        await vi.waitFor(() => expect(fs.state.listeners.has('designs/copy')).toBe(true))
        emit_doc('designs/copy', design_doc(make_blueprint()))
        expect(await duplicating).toBe('copy')
    })

})


describe('the wizard', () => {

    // Leaving simple mode is one-way and shown at once
    it('leaves simple mode optimistically', async () => {
        const {designs} = await load()
        designs.design_wizard.simple_mode = true
        await designs.leave_simple_mode('d1')
        expect(designs.design_wizard.simple_mode).toBe(false)
        expect(last_update()).toEqual({simple_mode: false})
    })

    // A wizard edit rebuilds the blueprint but keeps a name set from the list
    it('rebuilds the blueprint from an edited draft, keeping the design\'s name', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint({name: 'Kept'}))
        mocks.build_new_blueprint.mockResolvedValueOnce(make_blueprint({name: '',
            show_verses: false}))
        const draft = {title: 'New'} as never
        await designs.apply_wizard_edit('d1', draft)
        expect(blue.name).toBe('Kept')
        expect(blue.show_verses).toBe(false)
        expect(designs.design_wizard.wizard_draft).toEqual(draft)
        expect(last_update()).toEqual({wizard_draft: draft})
    })

})


describe('renaming and categories', () => {

    // A cover with a title the user hasn't set follows the design's name
    const cover = (title_custom:boolean) => ({title_custom, form: {}}) as unknown as CoverConfig

    // An open design is renamed through the sync, like any edit
    it('renames the open design through the sync', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        await designs.rename_design('d1', '  Trimmed  ')
        expect(blue.name).toBe('Trimmed')
        expect(last_update()['name']).toBe('Trimmed')
    })

    // A closed design's cover title follows its name, which is a render change
    it('carries a closed design\'s name to a cover title the user hasn\'t set', async () => {
        const {designs} = await load()
        fs.state.stored.set('designs/d2', design_doc(make_blueprint({cover: cover(false)})))
        await designs.rename_design('d2', 'Psalms')
        expect(last_update('designs/d2')).toEqual({
            name: 'Psalms', [`blueprint.cover.form.${COVER_TITLE_KEY}`]: 'Psalms',
            save_token: 'token_1', modified: fs.SERVER_TS})
    })

    // ...but never over one they chose, nor with a blank name, nor without a cover
    it('leaves a custom cover title, a blank name or a missing cover alone', async () => {
        const {designs} = await load()
        fs.state.stored.set('designs/d2', design_doc(make_blueprint({cover: cover(true)})))
        await designs.rename_design('d2', 'Psalms')
        expect(last_update('designs/d2')).toEqual({name: 'Psalms'})
        fs.state.stored.set('designs/d2', design_doc(make_blueprint({cover: cover(false)})))
        await designs.rename_design('d2', ' ')
        expect(last_update('designs/d2')).toEqual({name: ''})
        await designs.rename_design('d3', 'No doc')
        expect(last_update('designs/d3')).toEqual({name: 'No doc'})
    })

    // Categories are a field on each design, so renaming or clearing one is a batch
    it('sets, renames and clears categories across the designs in them', async () => {
        const {designs} = await load()
        await designs.set_design_category('d1', 'Gifts')
        expect(last_update()).toEqual({category: 'Gifts'})

        await boot(designs)
        emit_query('designs', [
            ['a', design_doc(make_blueprint(), {category: 'Gifts'})],
            ['b', design_doc(make_blueprint(), {category: 'Study'})],
            ['c', design_doc(make_blueprint(), {category: 'Gifts'})],
        ])
        await designs.designs_loaded
        fs.state.writes = []
        await designs.rename_category('Gifts', 'Presents')
        expect(fs.state.writes).toEqual([
            ['batch', 'designs/a', [['category', 'Presents']]],
            ['batch', 'designs/c', [['category', 'Presents']]],
        ])
        fs.state.writes = []
        await designs.clear_category('Study')
        expect(fs.state.writes).toEqual([['batch', 'designs/b', [['category', null]]]])
    })

})


describe('sharing', () => {

    // A removed editor's invite link stops working in the same write, so they can't rejoin
    it('removes an editor and rotates the invite in one write', async () => {
        const {designs} = await load()
        await designs.remove_design_editor('d1', 'u-2_x')
        expect(last_update()).toEqual({
            editor_uids: {op: 'array_remove', value: 'u-2_x'},
            'editors.u-2_x': fs.DELETE,
            share_token: 'token_1',
        })
        await designs.reset_design_share_token('d1')
        expect(last_update()).toEqual({share_token: 'token_2'})
    })

    // Leaving saves and closes the open design first, since its writes are refused afterwards
    it('leaves a design, saving and closing it first when open', async () => {
        const {designs, blue} = await load()
        await open(designs, make_blueprint())
        blue.show_verses = false
        await designs.leave_design('d1')
        const [leave, flush] = updates_to('designs/d1')
        expect(Object.fromEntries(flush!)).toHaveProperty('blueprint.show_verses', false)
        expect(Object.fromEntries(leave!)).toEqual({
            editor_uids: {op: 'array_remove', value: 'u1'}, 'editors.u1': fs.DELETE})
        expect(designs.current_design_id.value).toBe(null)
    })

    // The invite routes go through the server, and redeeming waits for the list to catch up
    it('previews, redeems and lists editors through the server', async () => {
        const {designs} = await load()
        mocks.api.mockResolvedValueOnce({name: 'Shared'})
        expect(await designs.fetch_design_invite_preview('d1', 'tok')).toEqual({name: 'Shared'})
        expect(mocks.api).toHaveBeenLastCalledWith('/api/design_invite_preview',
            {design_id: 'd1', token: 'tok'})

        mocks.api.mockResolvedValueOnce({editors: [{uid: 'u2'}]})
        expect(await designs.fetch_design_editors_info('d1')).toEqual([{uid: 'u2'}])

        vi.useFakeTimers()
        const redeeming = designs.redeem_design_share('d1', 'tok')
        await vi.advanceTimersByTimeAsync(10_000)
        await redeeming
        expect(mocks.api).toHaveBeenLastCalledWith('/api/redeem_design_invite',
            {design_id: 'd1', token: 'tok'})
    })

})


describe('the designs list', () => {

    // Each row is resolved off the raw doc, without building the whole blueprint
    it('lists designs with their resolved names, sharing and reusable assets', async () => {
        const {designs} = await load()
        await boot(designs)
        const custom_bg = {kind: 'custom', path: 'design_assets/a/h.jpg', hash: 'h'}
        emit_query('designs', [
            ['a', design_doc(make_blueprint({name: 'Named', content: [make_passage('p1')],
                cover: {bg_image: custom_bg, form: {}} as unknown as CoverConfig}), {
                editor_uids: ['u1', 'u2'], category: 'Gifts',
                fonts: {f1: {family: 'Lora', style: 'serif', files: ['x']}},
                created: fs.module.Timestamp.fromMillis(1000)})],
            ['b', design_doc(make_blueprint({bibles: ['gone_bible'],
                cover: {bg_image: {kind: 'builtin', id: 'hills.jpg'}, form: {}} as unknown as
                    CoverConfig}), {name_auto: 'Auto', owner: 'u2'})],
        ])
        await designs.designs_loaded
        const [a, b] = designs.designs
        expect(a).toMatchObject({id: 'a', name: 'Named', shared: true, editor_count: 2,
            category: 'Gifts', content_summary: expect.stringContaining('eng_bsb:gen'),
            assets: {fonts: [{family: 'Lora', style: 'serif', files: ['x']}],
                cover_bg: {path: 'design_assets/a/h.jpg', hash: 'h'}}})
        expect(a!.created).toEqual(new Date(1000))
        // A builtin background isn't the design's own to offer for reuse
        expect(b).toMatchObject({name: 'Auto', shared: false, assets: {fonts: [], cover_bg: null}})
        // A withdrawn translation shows as the one the design will open with
        expect(b!.paper.bibles).not.toContain('gone_bible')
    })

    // An account with no designs is welcomed once, and nothing is created for it
    it('greets an empty account only if this browser hasn\'t been welcomed', async () => {
        const {designs, state} = await load()
        const {done: booting} = await boot(designs)
        emit_query('designs', [])
        await booting
        expect(state.state.splash).toBe(true)
        expect(designs.current_design_id.value).toBe(null)
        expect(fs.state.writes).toEqual([])

        mocks.welcome_seen = true
        const {done: again} = await boot(designs)
        emit_query('designs', [])
        await again
        expect(state.state.splash).toBe(false)

        mocks.welcome_seen = false
        const {done: signed_out} = await boot(designs, null, false)
        emit_query('designs', [])
        await signed_out
        expect(state.state.splash).toBe(false)
    })

    // A requested design opens if it's ours, else the most recent does
    it('opens the requested design if listed, else the most recent', async () => {
        const {designs} = await load()
        const docs:[string, Record<string, unknown>][] = [['new', design_doc(make_blueprint())],
            ['old', design_doc(make_blueprint())]]

        const {done: requested} = await boot(designs, 'old')
        emit_query('designs', docs)
        await vi.waitFor(() => expect(fs.state.listeners.has('designs/old')).toBe(true))
        emit_doc('designs/old', docs[1]![1])
        await requested
        expect(designs.current_design_id.value).toBe('old')

        const {done: someone_elses} = await boot(designs, 'theirs')
        emit_query('designs', docs)
        await vi.waitFor(() => expect(fs.state.listeners.has('designs/new')).toBe(true))
        emit_doc('designs/new', docs[0]![1])
        await someone_elses
        expect(designs.current_design_id.value).toBe('new')
        expect(designs.design_sync_uid()).toBe('u1')
    })

    // A list that can't be read fails the boot rather than leaving it waiting forever
    it('fails the boot when the list can\'t be read', async () => {
        const {designs} = await load()
        const {done: booting} = await boot(designs)
        fs.state.listeners.get('query:designs')!.error(new Error('unavailable'))
        await expect(booting).rejects.toThrow('unavailable')
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {context: {listener: 'design_list'}})
    })

    // A design created server-side is only ours once the list says so
    it('waits for a design to be listed, giving up after a while', async () => {
        const {designs} = await load()
        await boot(designs)
        emit_query('designs', [['a', design_doc(make_blueprint())]])
        await designs.designs_loaded
        await designs.until_listed('a')

        const waiting = designs.until_listed('b')
        let listed = false
        void waiting.then(() => {
            listed = true
        })
        emit_query('designs', [['a', design_doc(make_blueprint())],
            ['b', design_doc(make_blueprint())]])
        await nextTick()
        await waiting
        expect(listed).toBe(true)

        vi.useFakeTimers()
        const never = designs.until_listed('c')
        await vi.advanceTimersByTimeAsync(10_000)
        await never
    })

    // Releasing everything before the uid changes, so no listener is re-issued as someone else
    it('stops every listener and forgets everything on sign-out', async () => {
        const {designs, blue, state} = await load()
        await boot(designs)
        emit_query('designs', [['d1', design_doc(make_blueprint())]])
        await vi.waitFor(() => expect(fs.state.listeners.has('designs/d1')).toBe(true))
        emit_doc('designs/d1', design_doc(make_blueprint()))
        await designs.start_viewed_sync()
        state.health.saving = 'offline'

        designs.stop_design_sync()
        expect(fs.state.listeners.size).toBe(0)
        expect(designs.designs).toEqual([])
        expect(designs.current_design_id.value).toBe(null)
        expect(designs.design_sync_uid()).toBe(null)
        expect(state.health.saving).toBe(null)

        // Nothing can be written afterwards either
        blue.show_verses = false
        await designs.flush_changes()
        expect(updates_to('designs/d1')).toEqual([])
    })

})


describe('read access', () => {

    // Designs seen through a version link, most recent first, and forgetting one
    it('mirrors the viewed list and forgets a design from it', async () => {
        const {designs} = await load()
        await designs.start_viewed_sync()
        fs.state.listeners.get('query:users/u1/viewed')!.next({docs: [
            {id: 'x', data: () => ({design_id: 'x', title: 'Theirs', last_version_id: 'v1',
                last_viewed: fs.module.Timestamp.fromMillis(5000)})},
            {id: 'y', data: () => ({design_id: 'y', title: 'Pending', last_version_id: 'v2',
                last_viewed: null})},
        ]})
        expect(designs.viewed_designs[0]).toEqual({design_id: 'x', title: 'Theirs',
            last_version_id: 'v1', last_viewed: new Date(5000)})
        expect(designs.viewed_designs[1]!.last_viewed).toBeInstanceOf(Date)

        fs.state.listeners.get('query:users/u1/viewed')!.error(new Error('denied'))
        expect(mocks.report_error).toHaveBeenCalledWith('silent', expect.any(Error),
            {context: {listener: 'viewed_list'}})

        await designs.forget_viewed('x')
        expect(fs.state.writes.at(-1)).toEqual(['delete', 'users/u1/viewed/x', []])
    })

})


describe('naming', () => {

    // A titled first passage names the design; otherwise its reference does
    it('derives a fallback name from the first item', async () => {
        const {designs} = await load()
        expect(designs.gen_name_auto(make_blueprint({content: []}))).toBe('')
        expect(designs.gen_name_auto(make_blueprint({
            content: [make_passage('p', {title: '  Creation '})]}))).toBe('Creation')
        expect(designs.gen_name_auto(make_blueprint({
            content: [make_passage('p', {title: ' '})]}))).toBe('eng_bsb:gen 1')
    })

    // A stored title always resolves to something, the placeholder at worst
    it('resolves a display name, falling back to the unnamed placeholder', async () => {
        const {designs} = await load()
        expect(designs.design_display_name(make_blueprint({name: 'Mine'}), 'Auto')).toBe('Mine')
        expect(designs.design_display_name(make_blueprint(), 'Auto')).toBe('Auto')
        expect(designs.design_display_name(make_blueprint(), '')).not.toBe('')
    })

})
