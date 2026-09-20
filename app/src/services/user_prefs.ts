
// Account-wide preferences, stored on the user's own root doc (`users/{uid}`).
//
// Distinct from the design and version data everything else here deals with: these belong to
// the person rather than to anything they've made, so they survive designs being deleted and
// travel with the account through a guest→signed-in upgrade.
//
// Read on demand rather than synced into a reactive: there's no UI that displays them, only
// code that asks once at a decision point, so a listener would cost a subscription for nothing.

import {doc, getDoc, setDoc} from 'firebase/firestore'

import {firestore} from '@/services/firebase'
import {user} from '@/services/auth'


export async function has_seen_print_service_warning():Promise<boolean>{
    // Whether the user has already been shown (and dismissed) the "review before printing"
    // warning — checked by BtnGenerate.vue right before creating a version for a real
    // (non-home) printing service
    const uid = user.value!.uid
    const snap = await getDoc(doc(firestore, 'users', uid))
    return !!snap.data()?.['seen_print_service_warning']
}


export async function record_seen_print_service_warning():Promise<void>{
    // Record that the user has dismissed the print-service warning, so it never shows again
    const uid = user.value!.uid
    await setDoc(doc(firestore, 'users', uid), {seen_print_service_warning: true}, {merge: true})
}
