
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


export async function api<T>(path:string, body?:unknown):Promise<T>{
    // Call the API server (Cloud Run via Hosting's /api rewrite, or Vite's dev proxy) with the
    // user's ID token attached
    const token = await firebase_auth.currentUser!.getIdToken()
    const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    })
    if (!response.ok){
        const error_body = await response.json().catch(() => null) as {error?:unknown}|null
        const code = typeof error_body?.error === 'string' ? error_body.error : 'unknown'
        throw new ApiError(path, response.status, code)
    }
    return await response.json() as T
}
