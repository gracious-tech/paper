
import {firebase_auth} from '@/services/firebase'


// A non-ok API response, carrying the server's structured error code (routes respond with
// {error: 'some_code'}) so callers can distinguish expected failures (e.g. 'unknown_share',
// 'still_pending') from real ones
export class ApiError extends Error {
    status:number
    code:string

    constructor(path:string, status:number, code:string){
        super(`API ${path} failed (${status} ${code})`)
        this.name = 'ApiError'
        this.status = status
        this.code = code
    }
}


// The request never reached the server — the user is offline, or the Firebase auth backend
// (in dev, the auth emulator) couldn't be reached while refreshing the ID token. Distinct from
// ApiError because nothing happened server-side at all, so callers can say "try again" rather
// than reporting it as a bug
export class ApiOfflineError extends Error {
    constructor(path:string, cause:unknown){
        super(`API ${path} unreachable (${cause instanceof Error ? cause.message : cause})`,
            {cause})
        this.name = 'ApiOfflineError'
    }
}


// The signed-in session is beyond recovery — its refresh token was refused, because the account
// was deleted or disabled, or (in dev) the auth emulator's data was reset out from under a
// browser that still holds the old session. Only a fresh sign-in gets the user working again
export class ApiSessionError extends Error {
    constructor(path:string, cause:unknown){
        super(`API ${path} refused: session no longer valid`, {cause})
        this.name = 'ApiSessionError'
    }
}


// Auth SDK codes meaning the stored credentials can't be refreshed (as opposed to a token that
// is merely stale, which getIdToken(true) fixes on its own)
const DEAD_SESSION_CODES = [
    'auth/user-token-expired',
    'auth/invalid-user-token',
    'auth/user-disabled',
    'auth/user-not-found',
]


// Whether a thrown error means the request never left the browser. fetch() rejects with a
// TypeError when it can't connect, and the auth SDK reports the same condition on its own token
// refresh as a FirebaseError with this code
function is_network_failure(error:unknown):boolean{
    return error instanceof TypeError
        || (error instanceof Error && 'code' in error
            && error.code === 'auth/network-request-failed')
}


export async function api<T>(path:string, body?:unknown):Promise<T>{
    // Call the API server (Cloud Run via Hosting's /api rewrite, or Vite's dev proxy) with the
    // user's ID token attached
    const current = firebase_auth.currentUser
    if (!current){
        throw new Error(`API ${path} called before sign-in completed`)
    }

    // Either half can fail before the request is made — getIdToken() hits Firebase's token
    // endpoint whenever the cached token has expired, so it isn't offline-safe either
    const send = async (force_refresh:boolean):Promise<Response> => {
        try {
            const token = await current.getIdToken(force_refresh)
            return await fetch(path, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
                },
                ...(body === undefined ? {} : {body: JSON.stringify(body)}),
            })
        } catch (error){
            if (is_network_failure(error)){
                throw new ApiOfflineError(path, error)
            }
            if (error instanceof Error && 'code' in error
                    && DEAD_SESSION_CODES.includes(error.code as string)){
                throw new ApiSessionError(path, error)
            }
            throw error
        }
    }

    // getIdToken() hands back its cached token whenever that hasn't expired by the SDK's own
    // reckoning, and the server can still refuse it — the account was linked or switched since
    // it was minted, or (in dev) it came from an emulator instance that has since restarted.
    // Forcing one refresh turns that dead end into a retry, so the user never sees it
    let response = await send(false)
    if (response.status === 401){
        response = await send(true)
    }

    if (!response.ok){
        const error_body = await response.json().catch(() => null) as {error?:unknown}|null
        const code = typeof error_body?.error === 'string' ? error_body.error : 'unknown'
        throw new ApiError(path, response.status, code)
    }
    return await response.json() as T
}
