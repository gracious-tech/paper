// Switching accounts mid-session (account.ts): following an account change another tab made
// (releasing this tab's listeners before their access goes, then reloading), deleting the
// account (listeners released before the server removes what they watch), and finishing a
// sign-in link opened on a device that never asked for it. Everything it calls is a stand-in,
// so what's asserted is the order of releases, reloads and messages

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// Every call made, in order, so the ordering rules can be asserted across modules
const calls = vi.hoisted(() => [] as string[])

// The ID-token listener account.ts registers at import, captured to be fired by hand
const token_listener = vi.hoisted(() => ({current: null as ((user:{uid:string}|null) => void)|null}))
vi.mock('firebase/auth', () => ({
    onIdTokenChanged: (_auth:unknown, listener:(user:{uid:string}|null) => void) => {
        token_listener.current = listener
    },
}))
vi.mock('@/services/firebase', () => ({firebase_auth: {}}))

// The uid whose data is loaded (null once released)
const synced_uid = vi.hoisted(() => ({current: null as string|null}))
vi.mock('@/services/designs', () => ({
    init_designs: vi.fn(async (_id:unknown, welcome:boolean) => {
        calls.push(`init_designs(${welcome})`)
    }),
    start_viewed_sync: vi.fn(async () => {
        calls.push('start_viewed_sync')
    }),
    stop_design_sync: () => {
        calls.push('stop_design_sync')
        synced_uid.current = null
    },
    design_sync_uid: () => synced_uid.current,
}))
vi.mock('@/services/versions', () => ({
    stop_versions_sync: () => {
        calls.push('stop_versions_sync')
    },
}))

const api = vi.hoisted(() => vi.fn(async (path:string, _body?:object) => {
    calls.push(`api ${path}`)
    return {ok: true}
}))
vi.mock('@/services/api', () => ({api}))

const auth = vi.hoisted(() => ({
    sign_out: vi.fn(async () => {
        calls.push('sign_out')
    }),
    complete_email_link: vi.fn(async (_link:string, _email:string) => 'signed_in' as string),
}))
vi.mock('@/services/auth', () => auth)

// The dialogs and messages the user sees
const ui = vi.hoisted(() => ({
    prompt_dialog: vi.fn(async (_message:string):Promise<string|null> => null),
    show_toast: vi.fn((_message:string) => undefined),
    report_failure: vi.fn((_error:unknown, _message:string) => undefined),
}))
vi.mock('@/services/state', () => ui)
vi.mock('@/services/i18n', () => ({translate: (key:string) => key}))

import {delete_account, finish_email_link, release_user_data, reload_user_data}
    from '@/services/account'


// Fire the token listener as Firebase would when the signed-in user changes
function token_changed(user:{uid:string}|null):void{
    token_listener.current!(user)
}


beforeEach(() => {
    calls.length = 0
    synced_uid.current = null
    vi.clearAllMocks()
})


describe('following an account change from another tab', () => {

    // location.reload, stubbed per test
    let reload:ReturnType<typeof vi.fn>

    beforeEach(() => {
        reload = vi.fn()
        vi.stubGlobal('location', {reload})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    // Nothing loaded yet, or the same user again (a token refresh): nothing to follow
    it('ignores changes while nothing is loaded, and a refresh of the same user', () => {
        token_changed({uid: 'a'})
        synced_uid.current = 'a'
        token_changed({uid: 'a'})
        expect(calls).toEqual([])
        expect(reload).not.toHaveBeenCalled()
    })

    // Another account signed in elsewhere: mute this tab's listeners, then start over as it
    it('releases the listeners and reloads when another user signs in', () => {
        synced_uid.current = 'a'
        token_changed({uid: 'b'})
        expect(calls).toEqual(['stop_design_sync', 'stop_versions_sync'])
        expect(reload).toHaveBeenCalledOnce()
    })

    // Signed out elsewhere: that tab is about to sign in as a new guest, so give it a moment
    it('waits for another tab signing out to finish before reloading', () => {
        vi.useFakeTimers()
        synced_uid.current = 'a'
        token_changed(null)
        expect(calls).toEqual(['stop_design_sync', 'stop_versions_sync'])
        vi.advanceTimersByTime(2999)
        expect(reload).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(reload).toHaveBeenCalledOnce()
    })

    // A switch made in this tab releases first, so the listener sees nothing loaded and leaves it
    it('leaves alone a switch this tab made itself', () => {
        synced_uid.current = 'a'
        release_user_data()
        calls.length = 0
        token_changed({uid: 'b'})
        expect(calls).toEqual([])
        expect(reload).not.toHaveBeenCalled()
    })

})


describe('reload_user_data', () => {

    // The designs come back (with or without the welcome), then the read-access list
    it('loads the new account\'s designs, then its read-access list', async () => {
        await reload_user_data()
        await reload_user_data(false)
        expect(calls).toEqual(['init_designs(true)', 'start_viewed_sync',
            'init_designs(false)', 'start_viewed_sync'])
    })

})


describe('delete_account', () => {

    // Listeners go first (the server deletes what they watch), then the account, then a fresh guest
    it('releases the listeners before the server deletes anything, then starts a guest', async () => {
        await delete_account()
        expect(calls).toEqual(['stop_design_sync', 'stop_versions_sync',
            'api /api/delete_account', 'sign_out', 'init_designs(false)', 'start_viewed_sync'])
        // A body, so it goes as the POST the route only accepts
        expect(api).toHaveBeenCalledWith('/api/delete_account', {})
    })

    // A refused deletion leaves the account signed in
    it('signs nothing out when the server refuses', async () => {
        api.mockRejectedValueOnce(new Error('refused'))
        await expect(delete_account()).rejects.toThrow('refused')
        expect(auth.sign_out).not.toHaveBeenCalled()
    })

})


describe('finish_email_link', () => {

    // Asked for the address the link was sent to; nothing entered means stay a guest
    it('does nothing when the address prompt is cancelled or left blank', async () => {
        ui.prompt_dialog.mockResolvedValueOnce(null).mockResolvedValueOnce('   ')
        await finish_email_link('https://paper.bible/?link')
        await finish_email_link('https://paper.bible/?link')
        expect(ui.prompt_dialog).toHaveBeenCalledWith('app.confirm_email')
        expect(auth.complete_email_link).not.toHaveBeenCalled()
        expect(calls).toEqual([])
    })

    // The trimmed address completes the link, with this account's data released first
    it('completes the link with the address given, then reloads the account\'s data', async () => {
        ui.prompt_dialog.mockResolvedValueOnce(' me@example.com ')
        auth.complete_email_link.mockImplementationOnce(async () => {
            calls.push('complete_email_link')
            return 'signed_in'
        })
        await finish_email_link('https://paper.bible/?link')
        expect(auth.complete_email_link).toHaveBeenCalledWith('https://paper.bible/?link',
            'me@example.com')
        expect(calls).toEqual(['stop_design_sync', 'stop_versions_sync', 'complete_email_link',
            'init_designs(false)', 'start_viewed_sync'])
        expect(ui.show_toast).not.toHaveBeenCalled()
    })

    // A spent link says so, and the guest's data still comes back
    it('says when the link has expired, and reloads the guest\'s data anyway', async () => {
        ui.prompt_dialog.mockResolvedValueOnce('me@example.com')
        auth.complete_email_link.mockResolvedValueOnce('expired')
        await finish_email_link('https://paper.bible/?link')
        expect(ui.show_toast).toHaveBeenCalledWith('app.sign_in_link_expired')
        expect(calls.slice(-2)).toEqual(['init_designs(false)', 'start_viewed_sync'])
    })

    // Any other failure is shown and reported, not thrown at the caller
    it('reports a failed sign-in instead of throwing', async () => {
        const error = new Error('auth/network-request-failed')
        ui.prompt_dialog.mockResolvedValueOnce('me@example.com')
        auth.complete_email_link.mockRejectedValueOnce(error)
        await finish_email_link('https://paper.bible/?link')
        expect(ui.report_failure).toHaveBeenCalledWith(error, 'app.sign_in_failed')
    })

})
