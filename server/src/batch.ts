
// Chunked Firestore batch writes, shared by the handlers that move or remove whole sets of
// docs at once (account merge, design deletion)

import {admin_db} from './firebase.ts'

import type {FieldPath} from 'firebase-admin/firestore'


// Firestore batches cap at 500 operations (and field transforms count extra), so stay well
// under it per chunk — an account with a large history must not fail a whole operation
const BATCH_CHUNK_OPS = 250


// A WriteBatch stand-in that transparently rotates to a new batch at the chunk limit and
// commits them sequentially. Chunking trades the single batch's atomicity for unbounded size,
// which suits the callers here — they move or remove whole sets of docs, so a partial failure
// just leaves some behind for a retry to pick up
export class ChunkedBatch {

    private batches:FirebaseFirestore.WriteBatch[] = []
    private ops = 0

    private next():FirebaseFirestore.WriteBatch{
        // The batch currently being filled, rotating at the chunk limit
        if (this.ops % BATCH_CHUNK_OPS === 0){
            this.batches.push(admin_db.batch())
        }
        this.ops += 1
        return this.batches[this.batches.length - 1]!
    }

    update(ref:FirebaseFirestore.DocumentReference,
            ...args:[FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>]
                |[string|FieldPath, unknown, ...unknown[]]):void{
        // Mirror WriteBatch.update (both the object and field/value forms)
        (this.next().update as (ref:FirebaseFirestore.DocumentReference,
            ...rest:unknown[]) => unknown)(ref, ...args)
    }

    set(ref:FirebaseFirestore.DocumentReference, data:FirebaseFirestore.DocumentData,
            options?:FirebaseFirestore.SetOptions):void{
        // Mirror WriteBatch.set
        if (options){
            this.next().set(ref, data, options)
        } else {
            this.next().set(ref, data)
        }
    }

    delete(ref:FirebaseFirestore.DocumentReference):void{
        // Mirror WriteBatch.delete
        this.next().delete(ref)
    }

    async commit():Promise<void>{
        // Commit all accumulated chunks in order
        for (const batch of this.batches){
            await batch.commit()
        }
    }
}
