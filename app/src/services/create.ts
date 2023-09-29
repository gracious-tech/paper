
import {database} from '@/services/db'
import {gen_creation_url} from '@/services/backend'

import type {Creation} from '@/services/types'


// WARN Keep in sync with timeout in generator (generator/template.yaml)
const TIMEOUT_SECONDS = 600


// Monitor the creation of a PDF on the backend and update own state when have result
export function monitor_creation(creation:Creation){

    // Record time monitoring started
    const started = creation.created.getTime()

    const interval = setInterval(async () => {

        // Give up if exceed allowed time
        if (new Date().getTime() - started > 1000 * (TIMEOUT_SECONDS + 10)){
            creation.status = 'failed'
            void database.creations_set(creation)
            clearInterval(interval)
        }

        // Try to get results data
        let resp:Response
        try {
            resp = await fetch(gen_creation_url(creation.creation_id!, 'result'))
        } catch {
            return  // Network error, keep retrying until timeout
        }
        if (resp.status === 403 || resp.status === 404){
            return  // Result object not created yet
        }

        // Determine if success or not, save, and end monitoring
        try {
            const result = await resp.json()
            creation.status = result.error ? 'failed' : 'available'
            if (!result.error){
                creation.pages = result.pages
            }
        } catch {
            creation.status = 'failed'
        }
        void database.creations_set(creation)
        clearInterval(interval)

    }, 1000 * 2)
}
