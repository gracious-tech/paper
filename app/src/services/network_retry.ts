
// Riding out a lost connection partway through a version's compile. What a compile has produced
// by then (a finished PDF, a version ready to hand to the server) exists only in this tab, so a
// step that can't reach the network waits for it to come back rather than throwing that away.

import {version_progress} from '@/services/compile_progress'


// How long to keep retrying a step that fails for want of a connection while the browser still
// says it's online (a dropped mobile signal, a captive portal), and the gaps between tries
const NETWORK_RETRY_MS = 2 * 60 * 1000
const NETWORK_RETRY_GAPS_MS = [2000, 5000, 10000, 20000, 30000]


function until_online():Promise<void>{
    // Resolve once the browser says it's online again (straight away if it already is)
    if (navigator.onLine){
        return Promise.resolve()
    }
    return new Promise(resolve => {
        addEventListener('online', () => resolve(), {once: true})
    })
}


export async function retry_network<T>(attempt:() => Promise<T>,
        is_network:(error:unknown) => boolean, version_id:string):Promise<T>{
    // Run a step of a compile, trying again when it fails for want of a connection rather than
    // throwing away the work done so far. While the browser is offline that waits for as long as
    // it takes (the tab is still open, and the step's result exists nowhere else), saying so in
    // the version's progress if this tab is showing it; otherwise it retries after growing gaps
    // for up to NETWORK_RETRY_MS. Anything else it throws straight away
    let give_up_at = Date.now() + NETWORK_RETRY_MS
    for (let tries = 0; ; tries++){
        try {
            return await attempt()
        } catch (error){
            if (!is_network(error)){
                throw error
            }
            if (!navigator.onLine){
                const shown = version_progress[version_id]
                if (shown){
                    version_progress[version_id] = {stage: 'offline'}
                }
                await until_online()
                // The stage it was at before, unless the attempt was ended meanwhile
                if (shown && version_id in version_progress){
                    version_progress[version_id] = shown
                }
                give_up_at = Date.now() + NETWORK_RETRY_MS
                continue
            }
            if (Date.now() >= give_up_at){
                throw error
            }
            const gap = NETWORK_RETRY_GAPS_MS[Math.min(tries, NETWORK_RETRY_GAPS_MS.length - 1)]
            await new Promise(resolve => setTimeout(resolve, gap))
        }
    }
}
