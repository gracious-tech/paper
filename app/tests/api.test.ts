// The API client (api.ts): the ID token on every request, GET vs JSON POST, the one forced
// token refresh a 401 earns, and how each kind of failure is told apart — the server refusing
// (ApiError with its code), the request never leaving the browser (ApiOfflineError), and a
// session that can't be refreshed at all (ApiSessionError)

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// The signed-in user as the auth SDK holds it (null before sign-in completes)
const auth = vi.hoisted(() => ({currentUser: null as null|{
    getIdToken:(force?:boolean) => Promise<string>}}))
vi.mock('@/services/firebase', () => ({firebase_auth: auth}))

const {api, ApiError, ApiOfflineError, ApiSessionError} = await import('@/services/api')


// An error as the auth SDK throws it: an Error with a string code
function firebase_error(code:string):Error{
    return Object.assign(new Error(`Firebase: (${code})`), {code})
}


// A JSON response with a status
function json(status:number, body:unknown):Response{
    return new Response(JSON.stringify(body), {status,
        headers: {'content-type': 'application/json'}})
}


// Tokens handed out, by whether a refresh was forced
let get_id_token:ReturnType<typeof vi.fn>
let fetch_mock:ReturnType<typeof vi.fn>


beforeEach(() => {
    get_id_token = vi.fn(async (force?:boolean) => force ? 'fresh' : 'cached')
    auth.currentUser = {getIdToken: get_id_token as (force?:boolean) => Promise<string>}
    fetch_mock = vi.fn(async () => json(200, {ok: true}))
    vi.stubGlobal('fetch', fetch_mock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('api', () => {

    // Nothing can be authorised before there's a user, so it fails loudly rather than sending
    it('refuses to send before sign-in completes', async () => {
        auth.currentUser = null
        await expect(api('/api/x')).rejects.toThrow('before sign-in completed')
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    // With a body it POSTs JSON; without one it's a bare GET — both carrying the token
    it('sends the ID token, as a GET without a body and a JSON POST with one', async () => {
        expect(await api('/api/health')).toEqual({ok: true})
        expect(fetch_mock).toHaveBeenLastCalledWith('/api/health', {
            method: 'GET',
            headers: {Authorization: 'Bearer cached'},
        })

        await api('/api/copy_version', {version_id: 'v1'})
        expect(fetch_mock).toHaveBeenLastCalledWith('/api/copy_version', {
            method: 'POST',
            headers: {'Authorization': 'Bearer cached', 'Content-Type': 'application/json'},
            body: '{"version_id":"v1"}',
        })
    })

    // A 401 on the cached token is retried once with a forced refresh, unseen by the caller
    it('retries a 401 once with a freshly refreshed token', async () => {
        fetch_mock.mockResolvedValueOnce(json(401, {error: 'bad_token'}))
        expect(await api('/api/x', {})).toEqual({ok: true})
        expect(get_id_token.mock.calls).toEqual([[false], [true]])
        const auth_header = (call:unknown[]) =>
            (call[1] as {headers:Record<string, string>}).headers['Authorization']
        expect(fetch_mock.mock.calls.map(auth_header)).toEqual(['Bearer cached', 'Bearer fresh'])
    })

    // ...but only once: a second 401 is the server's answer
    it('reports a 401 that survives the refresh', async () => {
        fetch_mock.mockResolvedValue(json(401, {error: 'bad_token'}))
        const error = await api('/api/x').catch((error:unknown) => error)
        expect(error).toBeInstanceOf(ApiError)
        expect(error).toMatchObject({status: 401, code: 'bad_token'})
        expect(fetch_mock).toHaveBeenCalledTimes(2)
    })

    // The server's structured code is kept, so callers can tell expected refusals apart
    it('carries the server\'s error code on a refusal, or "unknown" without one', async () => {
        fetch_mock.mockResolvedValueOnce(json(409, {error: 'still_pending'}))
        await expect(api('/api/x', {})).rejects.toMatchObject(
            {name: 'ApiError', status: 409, code: 'still_pending',
                message: 'API /api/x failed (409 still_pending)'})

        // A body that isn't JSON, or whose error isn't a string, says nothing usable
        fetch_mock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', {status: 502}))
        await expect(api('/api/x', {})).rejects.toMatchObject({status: 502, code: 'unknown'})
        fetch_mock.mockResolvedValueOnce(json(500, {error: {nested: true}}))
        await expect(api('/api/x', {})).rejects.toMatchObject({status: 500, code: 'unknown'})
    })

    // fetch can't connect: nothing happened server-side, so it's "try again", not a bug
    it('calls a connection failure offline', async () => {
        fetch_mock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
        const error = await api('/api/x').catch((error:unknown) => error)
        expect(error).toBeInstanceOf(ApiOfflineError)
        expect((error as Error).message).toBe('API /api/x unreachable (Failed to fetch)')
        expect((error as Error).cause).toBeInstanceOf(TypeError)
    })

    // The token refresh can be what fails to connect, reported by the auth SDK in its own way
    it('calls the token refresh failing to connect offline too', async () => {
        get_id_token.mockRejectedValueOnce(firebase_error('auth/network-request-failed'))
        await expect(api('/api/x')).rejects.toBeInstanceOf(ApiOfflineError)
        expect(fetch_mock).not.toHaveBeenCalled()
    })

    // Credentials that can't be refreshed need a fresh sign-in, whichever way the SDK says so
    it.each(['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled',
        'auth/user-not-found'])('calls %s a dead session', async code => {
        get_id_token.mockRejectedValueOnce(firebase_error(code))
        const error = await api('/api/x').catch((error:unknown) => error)
        expect(error).toBeInstanceOf(ApiSessionError)
        expect((error as Error).message).toBe('API /api/x refused: session no longer valid')
    })

    // Anything else is passed through untouched, to be reported as what it is
    it('rethrows any other failure as it was', async () => {
        const odd = firebase_error('auth/internal-error')
        get_id_token.mockRejectedValueOnce(odd)
        await expect(api('/api/x')).rejects.toBe(odd)
        const plain = new Error('boom')
        fetch_mock.mockRejectedValueOnce(plain)
        await expect(api('/api/x')).rejects.toBe(plain)
    })

})
