
// Per-uid daily caps on the server's expensive routes, and the one-at-a-time compile lock.
//
// Anyone can mint an anonymous account, so these are a speed bump rather than a wall — what
// they stop is the cheap case, where a single caller loops one endpoint and multiplies our
// cost for free. Minting a fresh uid per batch costs an attacker real effort; looping a
// single one costs nothing at all, and that asymmetry is the whole point.
//
// Counting lives in Firestore rather than in memory because Lambda runs many concurrent,
// isolated execution environments — a per-instance counter would reset on every cold start
// (and share nothing with any other concurrent invocation) and be trivially evaded by
// spreading calls across them. The quota collections match no security rule, so clients can
// neither read their own count nor reset it.

import {Timestamp} from 'firebase-admin/firestore'
import {QUOTA_LIFETIME_MS} from 'paper-bible-typst'

import {admin_db} from './firebase.ts'


// One collection per throttled action, each holding one row per uid per day.
// WARN Every collection named here needs a TTL policy on `expires` adding to
// .bin/deploy_firebase_initial — without one the collection keeps a permanent row for every
// uid that ever hit the route
export const QUOTA_COMPILE = 'compile_quota'
export const QUOTA_COPY = 'copy_quota'

// Not a daily count but the same kind of per-uid throttle row: which server compile the user has
// running, if any (see claim_compile_lock). Its `expires` is both the lock's own lapse time and
// what the TTL policy collects it by, so a row a dead compile never released still goes away
export const COMPILE_LOCK = 'compile_lock'


// Every collection above, so account deletion can clear a user's counters without having to be
// updated each time one is added (see delete_user_records in account.ts)
export const QUOTA_COLLECTIONS = [QUOTA_COMPILE, QUOTA_COPY, COMPILE_LOCK]


// Server-side compiles per user per day (the in-browser WASM path is unthrottled — it costs
// the user's own device, not us)
export const DAILY_COMPILE_LIMIT = 50


// "Keep own copy" operations per user per day. Deliberately generous: the Storage rules permit
// a 200MB PDF, but a typical document is a tiny fraction of that, so a cap tight enough to bound
// the worst case would punish every ordinary user to constrain an attacker who could just mint
// another account anyway. Sized instead to be unreachable by hand — clicking "keep own copy"
// this many times in one day is not something a person does — while still cutting off an
// unattended loop, which is the only case that actually ran up a bill
export const DAILY_COPY_LIMIT = 200


// How long a compile lock holds before it lapses on its own. Above the compile function's 5-min
// timeout (infra/cloudformation.yml), so a compile still running always holds it, and no longer
// than STUCK_MS in the app, so by the time a version a dead compile left pending is offered a
// retry, the lock that compile held no longer refuses it
export const COMPILE_LOCK_MS = 6 * 60 * 1000


// What claim_compile_lock() found: the lock was free (and is now held for this version), or a
// live compile already holds it, for this same version or another of the user's
export type CompileLockClaim = 'claimed'|'same_version'|'other_version'


export async function quota_allows(collection:string, uid:string, limit:number):Promise<boolean>{
    // Count one attempt against the caller's daily quota for this action, refusing once over it.
    // A transaction because concurrent requests from one uid would otherwise both read the same
    // count and each write count+1, letting a parallel caller past the cap
    const day = new Date().toISOString().slice(0, 10)
    return await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`${collection}/${uid}`)
        const data = (await txn.get(doc_ref)).data()
        // A row from an earlier day counts as zero rather than being deleted — the TTL policy
        // collects it, and rewriting it here resets the window in the same write
        const count = (data?.['day'] === day ? data['count'] as number : 0) + 1
        if (count > limit){
            return false
        }
        txn.set(doc_ref, {day, count,
            expires: Timestamp.fromMillis(Date.now() + QUOTA_LIFETIME_MS)})
        return true
    })
}


export async function claim_compile_lock(uid:string, version_id:string)
        :Promise<CompileLockClaim>{
    // Take the user's compile lock for a version, unless a compile that hasn't lapsed holds it.
    // In Firestore for the same reason as the counts above: the route that claims it and the
    // compile that releases it run in different Lambda functions, let alone execution
    // environments. A transaction so two concurrent requests can't both find it free
    return await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`${COMPILE_LOCK}/${uid}`)
        const data = (await txn.get(doc_ref)).data()
        if (data && (data['expires'] as Timestamp).toMillis() > Date.now()){
            return data['version_id'] === version_id ? 'same_version' : 'other_version'
        }
        txn.set(doc_ref, {version_id,
            expires: Timestamp.fromMillis(Date.now() + COMPILE_LOCK_MS)})
        return 'claimed'
    })
}


export async function extend_compile_lock(uid:string, version_id:string):Promise<void>{
    // Restart a held lock's lifetime from now, for a compile that has just begun — it may have
    // waited in Lambda's async queue since the lock was claimed. Left alone if it has since
    // lapsed and passed to another version
    await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`${COMPILE_LOCK}/${uid}`)
        if ((await txn.get(doc_ref)).data()?.['version_id'] === version_id){
            txn.update(doc_ref, {expires: Timestamp.fromMillis(Date.now() + COMPILE_LOCK_MS)})
        }
    })
}


export async function release_compile_lock(uid:string, version_id:string):Promise<void>{
    // Free the user's compile lock once a version's compile is over, unless it has since lapsed
    // and passed to another version (whose compile still needs it)
    await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`${COMPILE_LOCK}/${uid}`)
        if ((await txn.get(doc_ref)).data()?.['version_id'] === version_id){
            txn.delete(doc_ref)
        }
    })
}
