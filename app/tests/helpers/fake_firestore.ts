
// An in-memory stand-in for the parts of firebase/firestore the version services use: docs by
// path, merged updates (dotted field paths included), transactions, a listener per doc that a
// test fires by hand, and per-operation failures to inject. Suites mock the real module with it:
//
//     vi.mock('firebase/firestore', async () => (await import('./helpers/fake_firestore')).module)
//
// and import `fake_db` from here to seed and inspect it (the same module instance either way)


// A doc or collection reference, as the code under test passes them around
interface FakeRef {
    path:string
    id:string
}

// A doc's data
type Data = Record<string, unknown>

// What a listener was given, to be fired by a test
interface Listener {
    next:(snapshot:FakeSnapshot) => void
    error:((error:unknown) => void)|undefined
}

// A doc snapshot
interface FakeSnapshot {
    id:string
    exists:() => boolean
    data:(options?:unknown) => Data
}


// The store and its knobs, reset between tests
export const fake_db = {
    docs: new Map<string, Data>(),
    // Rows addDoc wrote, by collection
    added: new Map<string, Data[]>(),
    listeners: new Map<string, Listener[]>(),
    // An error to throw from the next matching call, by operation and doc path ('*' = any)
    failures: new Map<string, unknown>(),
    // Every updateDoc, in order, for asserting what was written and when
    updates: [] as {path:string, fields:Data}[],

    reset(){
        this.docs.clear()
        this.added.clear()
        this.listeners.clear()
        this.failures.clear()
        this.updates = []
    },

    // Make an operation ('get'|'update'|'set'|'transaction'|'listen') on a path throw
    fail(operation:string, path:string, error:unknown = new Error(`${operation} ${path} failed`)){
        this.failures.set(`${operation}:${path}`, error)
    },

    // Fire a query's listeners with every doc now in its collection
    emit_query(path:string){
        const prefix = `${path}/`
        const docs = [...this.docs.keys()].filter(key => key.startsWith(prefix)).map(doc_snapshot)
        for (const listener of this.listeners.get(path) ?? []){
            (listener.next as unknown as (snapshot:{docs:unknown[]}) => void)({docs})
        }
    },

    // Fire a doc's listeners with its current state, or with an error
    emit(path:string, error?:unknown){
        for (const listener of this.listeners.get(path) ?? []){
            if (error === undefined){
                listener.next(snapshot(path))
            } else {
                listener.error?.(error)
            }
        }
    },
}


// A Firestore Timestamp, as much of one as the code under test reads
class FakeTimestamp {
    constructor(private ms:number){}
    toDate(){
        return new Date(this.ms)
    }
    toMillis(){
        return this.ms
    }
}


// A deep copy of plain data, keeping anything else (timestamps) as the same instance, as
// structuredClone would drop their methods
function clone<T>(value:T):T{
    if (Array.isArray(value)){
        return value.map(clone) as T
    }
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype){
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
    }
    return value
}


// Throw the failure injected for an operation on a path, if any
function check_failure(operation:string, path:string):void{
    for (const key of [`${operation}:${path}`, `${operation}:*`]){
        if (fake_db.failures.has(key)){
            const error = fake_db.failures.get(key)
            fake_db.failures.delete(key)
            throw error
        }
    }
}


// A snapshot of a doc as it is now
function snapshot(path:string):FakeSnapshot{
    const data = fake_db.docs.get(path)
    return {
        id: path.split('/').pop()!,
        exists: () => data !== undefined,
        data: () => clone(data ?? {}),
    }
}


// Merge fields into a doc, where a dotted key sets a field inside a map
function apply_update(path:string, fields:Data):void{
    const data = fake_db.docs.get(path)
    if (!data){
        throw Object.assign(new Error(`No document to update: ${path}`), {code: 'not-found'})
    }
    for (const [key, value] of Object.entries(fields)){
        const parts = key.split('.')
        let target = data
        for (const part of parts.slice(0, -1)){
            target[part] ??= {}
            target = target[part] as Data
        }
        target[parts.at(-1)!] = value
    }
    fake_db.updates.push({path, fields})
}


// A doc's path in a query result, by id
function doc_snapshot(path:string){
    return {...snapshot(path), ref: {path, id: path.split('/').pop()!}}
}


// The firebase/firestore surface itself
export const module = {
    doc: (_db:unknown, ...segments:string[]):FakeRef =>
        ({path: segments.join('/'), id: segments.at(-1)!}),
    collection: (_db:unknown, ...segments:string[]):FakeRef =>
        ({path: segments.join('/'), id: segments.at(-1)!}),

    getDoc: async (ref:FakeRef) => {
        check_failure('get', ref.path)
        return snapshot(ref.path)
    },
    setDoc: async (ref:FakeRef, data:Data, options?:{merge?:boolean}) => {
        check_failure('set', ref.path)
        fake_db.docs.set(ref.path, {...options?.merge && fake_db.docs.get(ref.path),
            ...clone(data)})
    },
    updateDoc: async (ref:FakeRef, fields:Data) => {
        check_failure('update', ref.path)
        apply_update(ref.path, fields)
    },
    addDoc: async (ref:FakeRef, data:Data) => {
        check_failure('add', ref.path)
        fake_db.added.set(ref.path, [...fake_db.added.get(ref.path) ?? [], data])
        return {id: `added_${fake_db.added.get(ref.path)!.length}`}
    },
    runTransaction: async (_db:unknown,
            run:(transaction:{get:(ref:FakeRef) => Promise<FakeSnapshot>,
                update:(ref:FakeRef, fields:Data) => void}) => Promise<void>) => {
        check_failure('transaction', '*')
        await run({
            get: async ref => snapshot(ref.path),
            update: (ref, fields) => apply_update(ref.path, fields),
        })
    },

    onSnapshot: (target:FakeRef|{query:FakeRef}, next:Listener['next'],
            error?:Listener['error']) => {
        const path = 'query' in target ? target.query.path : target.path
        check_failure('listen', path)
        const listener = {next, error}
        fake_db.listeners.set(path, [...fake_db.listeners.get(path) ?? [], listener])
        return () => {
            fake_db.listeners.set(path,
                (fake_db.listeners.get(path) ?? []).filter(item => item !== listener))
        }
    },

    // Queries resolve to every doc in their collection (no suite here depends on filtering)
    query: (ref:FakeRef) => ({query: ref}),
    where: () => null,
    orderBy: () => null,
    limit: () => null,
    getDocs: async (target:{query:FakeRef}) => {
        check_failure('get', target.query.path)
        const prefix = `${target.query.path}/`
        return {docs: [...fake_db.docs.keys()].filter(path => path.startsWith(prefix))
            .map(doc_snapshot)}
    },

    serverTimestamp: () => ({server_timestamp: true}),
    Timestamp: {
        fromMillis: (ms:number) => new FakeTimestamp(ms),
        now: () => new FakeTimestamp(Date.now()),
    },
}
