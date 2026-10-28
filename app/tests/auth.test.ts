// Signing in (auth.ts): the anonymous guest every visitor starts as, waiting out a moment with no
// user rather than racing another tab, upgrading a guest by Google (linking in place, or
// switching to an existing account and merging the guest into it), and passwordless email links.
// The Firebase SDK is a stand-in whose behaviour each test sets, so what's asserted is which
// outcome each answer from it leads to, and when the server is asked to merge

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// A user as the SDK hands it out
interface FakeUser {
    uid:string
    isAnonymous:boolean
    photoURL?:string|null
    providerData:{photoURL:string|null}[]
    getIdToken:() => Promise<string>
}

// The SDK's auth object, and every ID-token listener registered on it (with unsubscribed ones
// removed), so a test can announce a user as Firebase would
const fake = vi.hoisted(() => ({
    auth: {
        currentUser: null as unknown,
        authStateReady: async () => undefined,
    },
    listeners: new Set<(user:unknown) => void>(),
}))

const sdk = vi.hoisted(() => ({
    signInAnonymously: vi.fn(),
    signOut: vi.fn(),
    linkWithPopup: vi.fn(),
    signInWithCredential: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn((_auth:unknown, link:string) => link.includes('oobCode')),
    signInWithEmailLink: vi.fn(),
    credential_from_error: vi.fn(),
}))

vi.mock('firebase/auth', () => {
    // Only `credentialFromError` is read off the provider; constructing one is all else
    class GoogleAuthProvider {
        static credentialFromError(error:unknown){
            return sdk.credential_from_error(error)
        }
    }
    return {
        ...sdk,
        GoogleAuthProvider,
        onIdTokenChanged: (_auth:unknown, listener:(user:unknown) => void) => {
            fake.listeners.add(listener)
            return () => fake.listeners.delete(listener)
        },
    }
})
vi.mock('@/services/firebase', () => ({firebase_auth: fake.auth}))

const api = vi.hoisted(() => vi.fn(async (_path:string, _body?:object) => ({ok: true})))
vi.mock('@/services/api', () => ({api}))

// The token getter auth.ts hands the error reporter at import
const error_auth = vi.hoisted(() => ({getter: null as (() => Promise<string|null>)|null}))
vi.mock('@/services/errors', () => ({
    set_error_auth: (getter:() => Promise<string|null>) => {
        error_auth.getter = getter
    },
}))

import {complete_email_link, ensure_signed_in, is_anonymous, is_email_link, link_google,
    photo_url, send_email_link, sign_out, signed_in_user, stored_email_for_link, user}
    from '@/services/auth'



// A user with the given uid, a guest unless told otherwise
function make_user(uid:string, overrides:Partial<FakeUser> = {}):FakeUser{
    return {uid, isAnonymous: true, providerData: [],
        getIdToken: async () => `token_${uid}`, ...overrides}
}

// Make `user` the SDK's current user, announcing it as Firebase does
function become(next:FakeUser|null):void{
    fake.auth.currentUser = next
    for (const listener of [...fake.listeners]){
        listener(next)
    }
}

// An SDK failure with a code, as Firebase throws them
function auth_error(code:string):Error{
    return Object.assign(new Error(code), {code})
}


// A plain in-memory localStorage
let storage:Map<string, string>

beforeEach(() => {
    vi.clearAllMocks()
    fake.auth.currentUser = null
    storage = new Map()
    vi.stubGlobal('localStorage', {
        getItem: (key:string) => storage.get(key) ?? null,
        setItem: (key:string, value:string) => storage.set(key, value),
        removeItem: (key:string) => storage.delete(key),
    })
    vi.stubGlobal('location', {origin: 'https://paper.bible'})
    sdk.signInAnonymously.mockImplementation(async () => {
        become(make_user('guest'))
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})


describe('the signed-in user', () => {

    // The reactive user follows the SDK, and what's derived from it with it
    it('follows the SDK\'s user, with whether they are a guest and their photo', () => {
        become(make_user('a'))
        expect(user.value?.uid).toBe('a')
        expect(is_anonymous.value).toBe(true)
        expect(photo_url.value).toBe(null)

        // A linked account's photo, from the provider's copy when the top-level one is empty
        become(make_user('b', {isAnonymous: false, photoURL: null,
            providerData: [{photoURL: null}, {photoURL: 'https://lh3.googleusercontent.com/a/x'}]}))
        expect(is_anonymous.value).toBe(false)
        expect(photo_url.value).toBe('https://lh3.googleusercontent.com/a/x')

        // Nobody signed in counts as a guest
        become(null)
        expect(is_anonymous.value).toBe(true)
    })

    // Error reports carry the current user's token, or nothing when there's no user
    it('gives the error reporter the current user\'s token', async () => {
        expect(await error_auth.getter!()).toBe(null)
        fake.auth.currentUser = make_user('a')
        expect(await error_auth.getter!()).toBe('token_a')
    })

})


describe('ensure_signed_in', () => {

    // A returning visitor keeps the user persisted from before
    it('keeps a persisted user rather than minting a new guest', async () => {
        fake.auth.currentUser = make_user('returning')
        expect((await ensure_signed_in()).uid).toBe('returning')
        expect(sdk.signInAnonymously).not.toHaveBeenCalled()
        expect(user.value?.uid).toBe('returning')
    })

    // A first visit signs in as a guest
    it('signs a first-time visitor in as a guest', async () => {
        expect((await ensure_signed_in()).uid).toBe('guest')
        expect(sdk.signInAnonymously).toHaveBeenCalledOnce()
    })

})


describe('signed_in_user', () => {

    // The usual case: there's a user, so there's nothing to wait for
    it('returns the current user straight away', async () => {
        fake.auth.currentUser = make_user('a')
        expect((await signed_in_user()).uid).toBe('a')
    })

    // Another tab mid-way through signing out: its new guest arrives, and is used
    it('waits for a user to arrive rather than signing in itself', async () => {
        vi.useFakeTimers()
        const pending = signed_in_user()
        // A null announcement (the sign-out itself) isn't the user being waited for
        become(null)
        become(make_user('from_other_tab'))
        expect((await pending).uid).toBe('from_other_tab')
        expect(sdk.signInAnonymously).not.toHaveBeenCalled()
        // It stopped listening once it had one
        expect(fake.listeners.size).toBe(1)
    })

    // Nobody arrives within the wait: sign in as a guest here after all
    it('signs in as a guest once the wait runs out', async () => {
        vi.useFakeTimers()
        const pending = signed_in_user()
        await vi.advanceTimersByTimeAsync(3000)
        expect((await pending).uid).toBe('guest')
        expect(sdk.signInAnonymously).toHaveBeenCalledOnce()
        expect(fake.listeners.size).toBe(1)
    })

})


describe('sign_out', () => {

    // Signing out always lands on a fresh guest, never on nobody
    it('signs out, then in again as a fresh guest', async () => {
        fake.auth.currentUser = make_user('me', {isAnonymous: false})
        sdk.signOut.mockImplementationOnce(async () => {
            become(null)
        })
        expect((await sign_out()).uid).toBe('guest')
        expect(sdk.signOut).toHaveBeenCalledOnce()
    })

})


describe('link_google', () => {

    beforeEach(() => {
        fake.auth.currentUser = make_user('guest')
    })

    // Linking keeps the guest's uid, so their work stays put with nothing else to do
    it('links the guest in place', async () => {
        expect(await link_google()).toBe('linked')
        expect(sdk.linkWithPopup.mock.calls[0]![0]).toBe(fake.auth.currentUser)
        expect(api).not.toHaveBeenCalled()
    })

    // Closing the popup, or clicking again while one is open, is the user's choice
    it('treats a dismissed popup as cancelled, and a refused one as blocked', async () => {
        for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request',
                'auth/user-cancelled']){
            sdk.linkWithPopup.mockRejectedValueOnce(auth_error(code))
            expect(await link_google()).toBe('cancelled')
        }
        sdk.linkWithPopup.mockRejectedValueOnce(auth_error('auth/popup-blocked'))
        expect(await link_google()).toBe('blocked')
    })

    // The Google account already has an account: sign into it, then merge the guest across,
    // taking the guest's token while it's still the one signed in
    it('switches to an existing account and merges the guest into it', async () => {
        const credential = {provider: 'google.com'}
        const order:string[] = []
        sdk.linkWithPopup.mockRejectedValueOnce(auth_error('auth/credential-already-in-use'))
        sdk.credential_from_error.mockReturnValueOnce(credential)
        sdk.signInWithCredential.mockImplementationOnce(async () => {
            order.push('sign_in')
            become(make_user('existing', {isAnonymous: false}))
        })
        api.mockImplementationOnce(async () => {
            order.push('merge')
            return {ok: true}
        })
        const on_merging = vi.fn(() => order.push('on_merging'))

        expect(await link_google(on_merging)).toBe('merged')
        expect(sdk.signInWithCredential).toHaveBeenCalledWith(fake.auth, credential)
        expect(api).toHaveBeenCalledWith('/api/merge_account', {anon_token: 'token_guest'})
        expect(order).toEqual(['on_merging', 'sign_in', 'merge'])
    })

    // An email already used by another account is the same situation
    it('merges for an email already in use too', async () => {
        sdk.linkWithPopup.mockRejectedValueOnce(auth_error('auth/email-already-in-use'))
        sdk.credential_from_error.mockReturnValueOnce({provider: 'google.com'})
        expect(await link_google()).toBe('merged')
    })

    // Without a credential to sign in with there's no way to merge, so it's a real failure
    it('throws when an already-linked error carries no credential, or for anything else', async () => {
        const no_credential = auth_error('auth/credential-already-in-use')
        sdk.linkWithPopup.mockRejectedValueOnce(no_credential)
        sdk.credential_from_error.mockReturnValueOnce(null)
        await expect(link_google()).rejects.toBe(no_credential)

        const other = auth_error('auth/network-request-failed')
        sdk.linkWithPopup.mockRejectedValueOnce(other)
        await expect(link_google()).rejects.toBe(other)
        expect(api).not.toHaveBeenCalled()
    })

})


describe('email sign-in links', () => {

    // The address is remembered for when the link comes back to this browser
    it('sends a link back to this site, remembering the address', async () => {
        await send_email_link('me@example.com')
        expect(stored_email_for_link()).toBe('me@example.com')
        expect(sdk.sendSignInLinkToEmail).toHaveBeenCalledWith(fake.auth, 'me@example.com',
            {url: 'https://paper.bible', handleCodeInApp: true})
    })

    // Recognising a sign-in link is the SDK's call
    it('recognises a sign-in link', () => {
        expect(is_email_link('https://paper.bible/?oobCode=x')).toBe(true)
        expect(is_email_link('https://paper.bible/designs')).toBe(false)
    })

    // Nothing stored means the link was opened somewhere else
    it('has no address for a link this browser never asked for', () => {
        expect(stored_email_for_link()).toBe(null)
    })

    // A guest signs in with the link, then their work is merged into that account
    it('signs a guest in with the link and merges the guest\'s work', async () => {
        storage.set('email_for_link', 'me@example.com')
        fake.auth.currentUser = make_user('guest')
        sdk.signInWithEmailLink.mockImplementationOnce(async () => {
            become(make_user('linked', {isAnonymous: false}))
        })
        expect(await complete_email_link('https://paper.bible/?oobCode=x', 'me@example.com'))
            .toBe('signed_in')
        expect(sdk.signInWithEmailLink).toHaveBeenCalledWith(fake.auth, 'me@example.com',
            'https://paper.bible/?oobCode=x')
        expect(api).toHaveBeenCalledWith('/api/merge_account', {anon_token: 'token_guest'})
        // The remembered address is spent along with the link
        expect(stored_email_for_link()).toBe(null)
    })

    // Someone already signed in is just switching accounts, so nothing is merged
    it('merges nothing for a user who was already signed in', async () => {
        fake.auth.currentUser = make_user('me', {isAnonymous: false})
        expect(await complete_email_link('link', 'me@example.com')).toBe('signed_in')
        expect(api).not.toHaveBeenCalled()
    })

    // A spent or stale link only needs a fresh one, so it's an outcome rather than an error
    it('reports a used or stale link as expired', async () => {
        fake.auth.currentUser = make_user('guest')
        for (const code of ['auth/invalid-action-code', 'auth/expired-action-code']){
            sdk.signInWithEmailLink.mockRejectedValueOnce(auth_error(code))
            expect(await complete_email_link('link', 'me@example.com')).toBe('expired')
        }
        expect(api).not.toHaveBeenCalled()
    })

    // Anything else is a real failure for the caller to report
    it('throws any other failure', async () => {
        fake.auth.currentUser = make_user('guest')
        const error = auth_error('auth/invalid-email')
        sdk.signInWithEmailLink.mockRejectedValueOnce(error)
        await expect(complete_email_link('link', 'nope')).rejects.toBe(error)
    })

})

