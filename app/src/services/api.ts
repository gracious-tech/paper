
import {firebase_auth} from '@/services/firebase'


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
        throw new Error(`API ${path} failed (${response.status})`)
    }
    return await response.json() as T
}
