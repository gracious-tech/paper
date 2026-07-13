
import {admin_auth} from './firebase.ts'


export async function verify_uid(auth_header:string|undefined):Promise<string|null>{
    // Verify a "Bearer <firebase id token>" Authorization header, returning the uid (or null)
    if (!auth_header?.startsWith('Bearer ')){
        return null
    }
    try {
        const decoded = await admin_auth.verifyIdToken(auth_header.slice('Bearer '.length))
        return decoded.uid
    } catch {
        return null
    }
}
