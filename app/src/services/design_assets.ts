
// Moving a design's uploaded assets between its three Storage prefixes, and asking the server
// to reclaim the ones it no longer references.
//
// Everything a user uploads lives under the open design rather than their account (see
// asset_paths.ts in the typst core for the scheme and why). Basenames are content-addressed
// and identical across the prefixes, so freezing a version is "make sure the same basename
// exists under version_assets/" rather than a re-upload — which means re-rendering an
// unchanged design moves no bytes at all.

import {ref as storage_ref, uploadBytes, getBytes, getMetadata} from 'firebase/storage'
import {debounce} from 'lodash-es'

import {firebase_storage, storage_bucket} from '@/services/firebase'
import {api} from '@/services/api'
import {report_error} from '@/services/errors'


// One asset that needs to exist at `to`, with the bytes available either in hand (a fresh
// upload, or font bytes already loaded in memory) or at `from` (an object to be copied)
export interface AssetCopy {
    to:string
    from?:string
    bytes?:Uint8Array
    content_type:string
}


export function storage_public_url(path:string):string {
    // A public download URL for a Storage object, built deterministically (no getDownloadURL()
    // round-trip, so it can be computed *before* the object exists) — needed because a version's
    // frozen blueprint must have its final image url at setDoc() time: Firestore rules forbid
    // ever patching `blueprint` afterwards, so freezing can't upload first and fill the url in
    // later. Storage rules must allow public `get` for the path (mirrored for the same reason
    // browsers can load <img src="..."> tags pointed at public Storage objects with no auth).
    // The server builds the identical string — see storage_public_url in server/src/assets.ts
    const base = import.meta.env.DEV
        ? 'http://localhost:9199' : 'https://firebasestorage.googleapis.com'
    return `${base}/v0/b/${storage_bucket}/o/${encodeURIComponent(path)}?alt=media`
}


async function object_exists(path:string):Promise<boolean> {
    // Whether a Storage object is already there, so an existing snapshot isn't re-uploaded
    try {
        await getMetadata(storage_ref(firebase_storage, path))
        return true
    } catch {
        return false
    }
}


export async function apply_asset_copies(copies:AssetCopy[]):Promise<void> {
    // Make sure every planned asset exists at its destination. Skips whatever is already
    // there, which is the common case: content-addressing means a re-render of unchanged
    // content finds every snapshot already in place and transfers nothing.
    // A denied create is treated as success rather than an error — version_assets is
    // append-only by rule, so the only way to be refused is that the object now exists (a
    // co-editor froze the same bytes first), and identical bytes is exactly what was wanted
    for (const copy of copies){
        if (await object_exists(copy.to)){
            continue
        }
        const bytes = copy.bytes
            ?? new Uint8Array(await getBytes(storage_ref(firebase_storage, copy.from!)))
        try {
            await uploadBytes(storage_ref(firebase_storage, copy.to), bytes,
                {contentType: copy.content_type})
        } catch (error){
            if (!await object_exists(copy.to)){
                throw error
            }
        }
    }
}


// Designs with a reconcile pending, so a burst of edits costs one request rather than one per
// change. Keyed by design id — switching designs mid-burst must still reconcile the first one
const pending_reconcile = new Set<string>()


const flush_reconcile = debounce(() => {
    // Ask the server to drop whatever each design no longer references. Fire-and-forget: this
    // only reclaims space, so a failure costs nothing the next edit won't retry
    const ids = [...pending_reconcile]
    pending_reconcile.clear()
    for (const design_id of ids){
        void api<{swept:number}>('/api/reconcile_design_assets', {design_id})
            .catch((error:unknown) => {
                report_error('silent', error, {context: {stage: 'reconcile_design_assets'}})
            })
    }
}, 5000)


export function request_reconcile(design_id:string):void {
    // Note that a design has stopped referencing something, so its unused uploads can be
    // reclaimed. Deliberately server-side and deliberately debounced: the server re-reads the
    // design doc, so it sees co-editors' concurrent changes that this client hasn't received
    // yet — deleting from here off a stale local blueprint could destroy an asset someone else
    // just started using. Callers must flush pending design writes first, or the doc the
    // server reads won't name what was only just added
    pending_reconcile.add(design_id)
    flush_reconcile()
}
