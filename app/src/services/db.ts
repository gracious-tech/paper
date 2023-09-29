
import {openDB, IDBPDatabase} from 'idb'
import {cloneDeep} from 'lodash-es'

import type {Creation} from './types'
import type {IDBPTransaction, DBSchema, StoreNames} from 'idb'


const DATABASE_VERSION = 1


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


export async function upgrade_database(db:IDBPDatabase<PaperDatabaseSchema>, old_version:number,
        transaction:VersionChangeTransaction):Promise<void>{
    // WARN Always await db methods to prevent overlap, but never anything else (transaction closes)
    if (old_version < 1){
        db.createObjectStore('config', {keyPath: 'key'})
        db.createObjectStore('creations', {keyPath: 'request_id'})
    }
}


class PaperDatabase {

    _conn!: IDBPDatabase<PaperDatabaseSchema>

    async connect():Promise<void>{
        // Init connection to the database
        // WARN May be called again if connection terminated
        this._conn = await openDB<PaperDatabaseSchema>('paper_bible', DATABASE_VERSION, {
            upgrade(db, old_version, new_version, transaction){
                void upgrade_database(db, old_version, transaction)
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
}


// Expose only a single instance of the database
export const database = new PaperDatabase()
