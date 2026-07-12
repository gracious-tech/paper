
import {execFileSync} from 'node:child_process'


// Minimal GCS JSON API client — one implementation for both production (gcloud CLI creds) and
// the Storage emulator (STORAGE_EMULATOR_HOST set → 'Bearer owner'), avoiding a dependency on
// @google-cloud/storage just for this tool


// Emulator host, e.g. localhost:9199 (either env var form works)
const emulator_host = process.env['STORAGE_EMULATOR_HOST']
    ?? process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ?? null

// The JSON API base (the emulator implements the same surface under /storage/v1)
const base_url = emulator_host
    ? `http://${emulator_host.replace(/^https?:\/\//, '')}/storage/v1`
    : 'https://storage.googleapis.com/storage/v1'

// Bearer token resolved once on first request
let access_token:string|null = null


function get_token():string{
    // Resolve the bearer token (the emulator accepts the literal 'owner' as admin)
    if (access_token === null){
        access_token = emulator_host
            ? 'owner'
            : execFileSync('gcloud', ['auth', 'print-access-token'], {encoding: 'utf8'}).trim()
    }
    return access_token
}


async function gcs_request(path:string, options:RequestInit = {}):Promise<Response>{
    // Perform an authenticated request against the GCS JSON API
    const response = await fetch(`${base_url}${path}`, {
        ...options,
        headers: {...options.headers, 'Authorization': `Bearer ${get_token()}`},
    })
    if (!response.ok && response.status !== 404){
        throw new Error(`GCS request failed (${response.status} ${response.statusText}): ${path}`)
    }
    return response
}


export async function list_error_objects(bucket:string):Promise<string[]>{
    // List all object names under the errors/ prefix (paginated)
    const names:string[] = []
    let page_token = ''
    while (true){
        const params = new URLSearchParams({prefix: 'errors/'})
        if (page_token){
            params.set('pageToken', page_token)
        }
        const response = await gcs_request(`/b/${bucket}/o?${params.toString()}`)
        const data = await response.json() as {items?:{name:string}[], nextPageToken?:string}
        names.push(...(data.items ?? []).map(item => item.name))
        if (!data.nextPageToken){
            return names
        }
        page_token = data.nextPageToken
    }
}


export async function download_object(bucket:string, name:string):Promise<string>{
    // Download an object's contents as text
    const response = await gcs_request(`/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`)
    return await response.text()
}


export async function delete_object(bucket:string, name:string):Promise<void>{
    // Delete an object (404 tolerated — already gone)
    await gcs_request(`/b/${bucket}/o/${encodeURIComponent(name)}`, {method: 'DELETE'})
}
