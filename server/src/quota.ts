
// Per-uid daily caps on the server's expensive routes.
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


// Every collection above, so account deletion can clear a user's counters without having to be
// updated each time one is added (see delete_user_records in account.ts)
export const QUOTA_COLLECTIONS = [QUOTA_COMPILE, QUOTA_COPY]


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
