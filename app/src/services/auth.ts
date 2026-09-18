
import {ref, computed} from 'vue'
import {signInAnonymously, onAuthStateChanged, signOut, GoogleAuthProvider, linkWithPopup,
    signInWithCredential, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
    linkWithCredential, EmailAuthProvider} from 'firebase/auth'
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


// Let error reports carry the user's uid (errors.ts can't import auth/firebase itself as it
// must be imported before everything else)
set_error_auth(async () => await firebase_auth.currentUser?.getIdToken() ?? null)


// The current Firebase user (anonymous or linked), null until auth has resolved
export const user = ref<User|null>(null)


// Whether the current user is a guest who hasn't linked a sign-in method yet
export const is_anonymous = computed(() => user.value?.isAnonymous ?? true)


// Keep the reactive user ref in sync with the SDK's auth state
onAuthStateChanged(firebase_auth, changed => {
    user.value = changed
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
        if (code === 'auth/credential-already-in-use'){
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


export async function complete_email_link():Promise<'linked'|'merged'|'expired'|null>{
    // Finish a passwordless email sign-in if the page was opened via such a link
    // (runs on boot before user data loads, so no reload is needed afterwards)
    if (!isSignInWithEmailLink(firebase_auth, location.href)){
        return null
    }

    // Consume the link before attempting anything that can fail — the code is single-use, so if
    // the URL stayed sign-in-shaped every later refresh would retry a spent code and re-prompt
    const link = location.href
    history.replaceState(null, '', location.pathname)
    const email = localStorage.getItem(EMAIL_FOR_LINK_KEY)
        ?? prompt("Please confirm your email address")  // Link opened on a different device
    localStorage.removeItem(EMAIL_FOR_LINK_KEY)
    if (!email){
        return null
    }

    const current = firebase_auth.currentUser!
    const credential = EmailAuthProvider.credentialWithLink(email, link)
    try {
        await linkWithCredential(current, credential)
        return 'linked'
    } catch (error){
        const code = (error as AuthError).code

        // Email already has a Paper Bible account — switch to it and merge
        // NOTE Linking failed, so the guest is still signed in and its token is safe to take now
        if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use'){
            const anon_token = await current.getIdToken()
            await signInWithEmailLink(firebase_auth, email, link)
            await merge_anon_account(anon_token)
            return 'merged'
        }

        // The link was already used or has gone stale — the user just needs a fresh one
        if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'){
            return 'expired'
        }

        throw error
    }
}
