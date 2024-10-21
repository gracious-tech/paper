
import {openDB, IDBPDatabase} from 'idb'
import {cloneDeep} from 'lodash-es'

import type {Blueprint, Creation} from './types'
import type {IDBPTransaction, DBSchema, StoreNames} from 'idb'


const DATABASE_VERSION = 3


export interface PaperDatabaseSchema extends DBSchema {

    config:{
        key:string  // The type of whatever key is used (defined during upgrade)
        value:{
            key:string
            value:unknown
        }
    }

    creations:{
        key:string
        value:Creation
    }
}


type VersionChangeTransaction = IDBPTransaction<
    PaperDatabaseSchema,
    StoreNames<PaperDatabaseSchema>[],
    'versionchange'
>


function _update_passage_props(blueprint:Blueprint){
    // Helper for migrating to the new names for passage properties
    for (const item of blueprint.content){
        // NOTE Tests for existance of new props as forgot to update draft object in DBv2
        if (item.type === 'passage' && !('start_chapter' in item)){  // @ts-ignore
            item.start_chapter = item.chapter_start  // @ts-ignore
            delete item.chapter_start  // @ts-ignore
            item.start_verse = item.verse_start  // @ts-ignore
            delete item.verse_start  // @ts-ignore
            item.end_chapter = item.chapter_end  // @ts-ignore
            delete item.chapter_end  // @ts-ignore
            item.end_verse = item.verse_end  // @ts-ignore
            delete item.verse_end
        }
    }
}


export async function upgrade_database(transaction:VersionChangeTransaction,
        old_version:number):Promise<void>{
    // WARN Always await db methods to prevent overlap, but never anything else (transaction closes)

    if (old_version < 1){
        // Create object stores
        transaction.db.createObjectStore('config', {keyPath: 'key'})
        transaction.db.createObjectStore('creations', {keyPath: 'request_id'})
    }

    if (old_version < 2){
        // Rename chapter/verse properties
        for await (const cursor of transaction.objectStore('creations')){
            _update_passage_props(cursor.value.blueprint)
            await cursor.update(cursor.value)
        }
    }

    if (old_version < 3){
        // Added `show_pages` property to blueprints
        for await (const cursor of transaction.objectStore('creations')){
            cursor.value.blueprint.show_pages = true
            await cursor.update(cursor.value)
        }
        const draft_record = await transaction.objectStore('config').get('draft')
        if (draft_record){
            ;(draft_record.value as Blueprint).show_pages = true
            // Forgot to update draft's props in DBv2
            _update_passage_props(draft_record.value as Blueprint)
            await transaction.objectStore('config').put(draft_record)
        }
    }
}


class PaperDatabase {

    _conn!: IDBPDatabase<PaperDatabaseSchema>

    async connect():Promise<void>{
        // Init connection to the database
        // WARN May be called again if connection terminated
        this._conn = await openDB<PaperDatabaseSchema>('paper_bible', DATABASE_VERSION, {
            upgrade(db, old_version, new_version, transaction){
                void upgrade_database(transaction, old_version)
            },
            blocked(){
                // Will soon unblock after other pages refresh...
                console.info("Database upgrade blocked (probably already resolved)")
            },
            blocking(){
                // If blocking an upgrade, reload to unblock
                self.location.reload()
            },
            terminated: () => {
                // Some browsers (especially Safari) close connection after a time
                void this.connect()
            },
        }).catch(error => {
            // IDB isn't available in some private tabs, webviews, etc (non-persistent fake instead)
            console.error(error)
            console.error("Database unavailable")
            return {
                /* eslint-disable @typescript-eslint/require-await -- async to mimic original */
                get: async () => undefined,
                getAll: async () => [],
                getAllFromIndex: async () => [],
                put: async () => undefined,
                delete: async () => undefined,
                /* eslint-enable @typescript-eslint/require-await */
            } as unknown as IDBPDatabase<PaperDatabaseSchema>
        })
    }

    async config_get_all():Promise<Record<string, unknown>>{
        // Get all key/values as an object
        const items = await this._conn.getAll('config')
        return items.reduce((obj, item) => {
            obj[item.key] = item.value
            return obj
        }, {} as Record<string, unknown>)
    }

    async config_set(key:string, value:unknown):Promise<void>{
        // Save a key/value in config table
        await this._conn.put('config', {key, value: cloneDeep(value)})
    }

    async creations_get_all():Promise<Creation[]>{
        // Get all creations
        return await this._conn.getAll('creations')
    }

    async creations_set(creation:Creation):Promise<void>{
        // Save a creation
        await this._conn.put('creations', cloneDeep(creation))
    }

    async creations_delete(creation:Creation):Promise<void>{
        // Delete a creation
        await this._conn.delete('creations', creation.request_id)
    }
}


// Expose only a single instance of the database
export const database = new PaperDatabase()
