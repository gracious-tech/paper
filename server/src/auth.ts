
import {admin_auth} from './firebase.ts'


export async function verify_uid(auth_header:string|undefined):Promise<string|null>{
    // Verify a "Bearer <firebase id token>" Authorization header, returning the uid (or null)
    if (!auth_header?.startsWith('Bearer ')){
        console.warn('auth: no bearer token')
        return null
    }
    try {
        const decoded = await admin_auth.verifyIdToken(auth_header.slice('Bearer '.length))
        return decoded.uid
    } catch (error){
        // Always log why. Callers turn any null into a bare 401 'unauthenticated', so without
        // this an expired token, a project-id mismatch and a malformed header are one symptom
        // with no way to tell them apart from either side of the wire
        console.warn(`auth: token rejected — ${error instanceof Error ? error.message : error}`)
        return null
    }
}
