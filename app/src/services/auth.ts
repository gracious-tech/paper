
import {ref, computed, triggerRef} from 'vue'
import {signInAnonymously, onIdTokenChanged, signOut, GoogleAuthProvider, linkWithPopup,
    signInWithCredential, sendSignInLinkToEmail, isSignInWithEmailLink,
    signInWithEmailLink} from 'firebase/auth'
import type {User, AuthError} from 'firebase/auth'

import {firebase_auth} from '@/services/firebase'
import {api} from '@/services/api'
import {set_error_auth} from '@/services/errors'


// localStorage key holding the address an email sign-in link was sent to (per Firebase docs)
const EMAIL_FOR_LINK_KEY = 'email_for_link'


// Popup failures that are the user's own doing (dismissed the window, or clicked sign-in again
// while an earlier popup was still open) — normal choices, never reported as faults
const POPUP_CANCEL_CODES = [
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/user-cancelled',
]


// Link failures meaning the identity already belongs to another Paper Bible account. Firebase
// picks the code by what it matched on — the exact credential, or merely the email (e.g. that
// address already signed in via an email link) — but either way the remedy is the same: sign
// into that account and have the server merge the guest's work across
const ALREADY_LINKED_CODES = [
    'auth/credential-already-in-use',
    'auth/email-already-in-use',
]


// Let error reports carry the user's uid (errors.ts can't import auth/firebase itself as it
// must be imported before everything else)
set_error_auth(async () => await firebase_auth.currentUser?.getIdToken() ?? null)


// The current Firebase user (anonymous or linked), null until auth has resolved
export const user = ref<User|null>(null)


// Whether the current user is a guest who hasn't linked a sign-in method yet
export const is_anonymous = computed(() => user.value?.isAnonymous ?? true)


// The signed-in user's profile photo (Google accounts), null when they don't have one
// NOTE Falls back to the provider's own copy, as a linked guest account may leave the top-level
// field empty
export const photo_url = computed(() => {
    return user.value?.photoURL ?? user.value?.providerData.find(p => p.photoURL)?.photoURL
        ?? null
})


// Keep the reactive user ref in sync with the SDK's auth state
// NOTE Listens for token changes rather than auth state changes, since linking a guest account
// keeps the same uid (no auth state change) but mutates the user object in place — triggerRef
// is what makes computeds re-read it, as the SDK writes to the raw object behind Vue's proxy
onIdTokenChanged(firebase_auth, changed => {
    user.value = changed
    triggerRef(user)
})


export async function ensure_signed_in():Promise<User>{
    // Sign in anonymously unless a user persisted from a previous visit
    // NOTE Auth state persists in IndexedDB, so returning visitors keep their anonymous uid
    await firebase_auth.authStateReady()
    if (!firebase_auth.currentUser){
        await signInAnonymously(firebase_auth)
    }
    user.value = firebase_auth.currentUser
    return firebase_auth.currentUser!
}


export async function sign_out():Promise<User>{
    // Sign out of the current account and start a fresh guest session
    // NOTE Callers must reload user data afterwards (designs/versions belong to the new uid)
    await signOut(firebase_auth)
    return ensure_signed_in()
}


// --- Upgrading a guest account -------------------------------------------------------------
// Linking keeps the same uid (work retained automatically). If the credential already belongs
// to an existing account we sign into that account instead, then have the server merge the
// guest's data across ('merged' result — callers must reload user data).


async function merge_anon_account(anon_token:string):Promise<void>{
    // Ask the server to move the (now orphaned) guest account's data into the current account
    await api('/api/merge_account', {anon_token})
}


export async function link_google(on_merging?:() => void)
        :Promise<'linked'|'merged'|'cancelled'|'blocked'>{
    // Upgrade the guest account via Google sign-in
    // WARN Nothing may be awaited before linkWithPopup(), or the popup no longer counts as
    //      user-initiated and browsers (Safari especially) block it
    // NOTE `on_merging` fires when the flow leaves the popup behind and starts doing work of its
    //      own, so callers know when it's worth showing progress
    const current = firebase_auth.currentUser!
    try {
        await linkWithPopup(current, new GoogleAuthProvider())
        return 'linked'
    } catch (error){
        const code = (error as AuthError).code

        // The user dismissed the popup, so there is nothing to do and nothing to report
        if (POPUP_CANCEL_CODES.includes(code)){
            return 'cancelled'
        }

        // The browser refused to open the popup — actionable by the user, not a fault
        if (code === 'auth/popup-blocked'){
            return 'blocked'
        }

        // Google account already has a Paper Bible account — switch to it and merge
        // NOTE Linking failed, so the guest is still signed in and its token is safe to take now
        if (ALREADY_LINKED_CODES.includes(code)){
            const credential = GoogleAuthProvider.credentialFromError(error as AuthError)
            if (credential){
                on_merging?.()
                const anon_token = await current.getIdToken()
                await signInWithCredential(firebase_auth, credential)
                await merge_anon_account(anon_token)
                return 'merged'
            }
        }

        throw error
    }
}


export async function send_email_link(email:string):Promise<void>{
    // Send a passwordless sign-in link (completed by complete_email_link() on next boot)
    localStorage.setItem(EMAIL_FOR_LINK_KEY, email)
    await sendSignInLinkToEmail(firebase_auth, email, {
        url: location.origin,
        handleCodeInApp: true,
    })
}


export function is_email_link(link:string):boolean{
    // Whether a page was opened via a passwordless email sign-in link
    return isSignInWithEmailLink(firebase_auth, link)
}


export function stored_email_for_link():string|null{
    // The address a sign-in link was sent to, when this browser is the one that requested it.
    // Null when the link was opened elsewhere (another browser or device), in which case the
    // address has to be asked for — see finish_email_link() in account.ts
    return localStorage.getItem(EMAIL_FOR_LINK_KEY)
}


export async function complete_email_link(link:string, email:string)
        :Promise<'signed_in'|'expired'>{
    // Finish a passwordless email sign-in, given the link the page was opened with and the
    // address it was sent to. The caller owns the URL — it must already have been cleaned of
    // the single-use code before getting here, or a later refresh would retry a spent one
    localStorage.removeItem(EMAIL_FOR_LINK_KEY)

    // Sign in with the link rather than linking it onto the guest account
    // WARN Whichever call is made first spends the code, so there is only ever one attempt and
    //      no fallback. Linking would keep the guest's uid, but it fails outright whenever the
    //      address already has an account — and by then the code is gone, so the sign-in that
    //      would have rescued it is impossible. Signing in always works, so do that and move the
    //      guest's work across afterwards
    const current = firebase_auth.currentUser!
    // Only a guest has work that needs carrying over; a signed-in user clicking an old link is
    // just switching accounts, and merging would drag the previous account's designs with them
    const guest_token = current.isAnonymous ? await current.getIdToken() : null
    try {
        await signInWithEmailLink(firebase_auth, email, link)
    } catch (error){
        const code = (error as AuthError).code

        // The link was already used or has gone stale — the user just needs a fresh one
        if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'){
            return 'expired'
        }

        throw error
    }

    // Carry the guest's designs into whichever account the link resolved to — a brand new one
    // (the address had no account) or a pre-existing one they're returning to
    if (guest_token){
        await merge_anon_account(guest_token)
    }
    return 'signed_in'
}
