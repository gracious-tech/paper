
// Whether this device compiles in its own browser or leaves it to the server. Every device starts
// out compiling in the browser, and is switched to the server for good once it shows it can't
// cope — only by failures that are the device's own (see is_device_failure): running out of
// memory, a preview taking too long (PREVIEW_TIMEOUT_MS on a phone, DESKTOP_PREVIEW_TIMEOUT_MS
// on a desktop), the engine failing to start, or the tab dying mid-compile, which on iOS gives no
// error to catch (the page just reloads), so it's noticed on the next boot from a marker left
// behind. An error in the Typst we generate, or a lost connection, says nothing about the device.
//
// A switch is provisional until the server has done the same kind of job (settle_server_mode):
// if the server fails it too, the fault was more likely the document or our own code than the
// device, which is switched back.
//
// The choice is this browser's alone, in localStorage: it's about the device, so it mustn't
// follow the account to another one.
//
// TODO(2027-02) Re-evaluate the switch being permanent once there's data (the compile_stats
// rows below) and feedback: a phone may deserve another go after an app update lowers memory use,
// or after a month in case the phone or its browser was upgraded

import {ref} from 'vue'
import {collection, addDoc, serverTimestamp, Timestamp} from 'firebase/firestore'
import {COMPILE_STATS_LIFETIME_MS} from 'paper-bible-typst'

import {firestore} from '@/services/firebase'
import {user} from '@/services/auth'
import {is_mobile_now} from '@/services/display'


// How long a phone's preview may take in the browser before it's abandoned and the device
// switched to the server
export const PREVIEW_TIMEOUT_MS = 20 * 1000

// How long a desktop's live preview may take before the server is asked instead. Shorter than a
// phone's, since a desktop recompiles as the user edits and is expected to keep up.
// TODO(2027-02) Reassess with the compile_stats rows, which time every browser preview
export const DESKTOP_PREVIEW_TIMEOUT_MS = 10 * 1000


// Why a device was switched to the server (recorded with the switch, see switch_to_server)
export type SwitchReason = 'crash'|'slow'|'memory'|'engine'


// A browser compile that ran out of memory: the WASM heap trapped, and did so again on a fresh
// worker (see send_compile in typst.ts), so the document is more than this device can hold
export class BrowserMemoryError extends Error {}

// A browser compile abandoned for taking too long (see within_timeout in phone_preview.ts and
// DisplayPreview.vue)
export class SlowCompileError extends Error {}


// localStorage keys: the device's mode ('1' once confirmed, 'provisional' until then), and when a
// compile on it began while one is running
const MODE_KEY = 'compile_on_server'
const IN_FLIGHT_KEY = 'compile_in_flight'


function read_key(key:string):string|null{
    // Read a localStorage key, as null wherever storage is unavailable (private modes, blocked
    // site data)
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}


function write_key(key:string, value:string|null):void{
    // Set or (null) remove a localStorage key, best-effort like read_key
    try {
        if (value === null){
            localStorage.removeItem(key)
        } else {
            localStorage.setItem(key, value)
        }
    } catch {
        // Without storage the device just keeps compiling in the browser
    }
}


// Whether this device has been switched to compiling on the server (provisionally or for good)
export const server_mode = ref(read_key(MODE_KEY) !== null)

// Whether that switch still awaits the server doing the same kind of job (see settle_server_mode)
let provisional = read_key(MODE_KEY) === 'provisional'


export function compiles_on_server():boolean{
    // Whether a compile asked for now should go to the server rather than this browser
    return server_mode.value
}


export function is_device_failure(error:unknown):boolean{
    // Whether a browser compile's failure was the device's own doing, and so a reason to switch
    // it to the server: out of memory, or too slow. Anything else (an error in the generated
    // Typst, a lost connection) would happen on the server too, or says nothing about the device
    return error instanceof BrowserMemoryError || error instanceof SlowCompileError
}


function record_mode(kind:'compile_mode'|'compile_mode_reverted', reason:string):void{
    // Record a change of mode for the decision above (best-effort: telemetry never matters more
    // than the change itself)
    if (user.value){
        void addDoc(collection(firestore, 'compile_stats'), {
            kind, reason, owner: user.value.uid, created: serverTimestamp(),
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
            user_agent: navigator.userAgent, mobile: is_mobile_now(),
        }).catch(() => undefined)
    }
}


export function switch_to_server(reason:SwitchReason):void{
    // Send this device's compiles to the server from now on, provisionally until the server has
    // done the same kind of job (see settle_server_mode)
    if (server_mode.value){
        return
    }
    server_mode.value = true
    provisional = true
    write_key(MODE_KEY, 'provisional')
    record_mode('compile_mode', reason)
}


export function switch_provisional():boolean{
    // Whether the device's switch to the server still awaits a job the server then does
    return provisional
}


export function settle_server_mode(server_ok:boolean):void{
    // Settle a provisional switch on the outcome of a job the server then did: success confirms
    // the device couldn't cope where the server could, while failure suggests the document (or
    // our code) was at fault, so the device goes back to compiling in its browser. A confirmed
    // switch is left alone either way: one failed server job says nothing about the device
    if (!provisional){
        return
    }
    provisional = false
    if (server_ok){
        write_key(MODE_KEY, '1')
    } else {
        server_mode.value = false
        write_key(MODE_KEY, null)
        record_mode('compile_mode_reverted', 'server_failed')
    }
}


export async function within_timeout<T>(compile:Promise<T>, timeout_ms:number,
        abandon:() => void):Promise<T>{
    // Await a browser compile, giving up on it with a SlowCompileError if it takes longer than
    // `timeout_ms`. `abandon` throws the compile away (no message can interrupt one, so the
    // worker is replaced, see TypstWorkerClient.abandon)
    let timer:ReturnType<typeof setTimeout>|undefined
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            abandon()
            reject(new SlowCompileError(`Preview took over ${timeout_ms}ms in the browser`))
        }, timeout_ms)
    })
    try {
        return await Promise.race([compile, timeout])
    } finally {
        clearTimeout(timer)
    }
}


// How many browser compiles are running on this device right now (see track_browser_compile)
let in_flight = 0


export function track_browser_compile<T>(compile:Promise<T>):Promise<T>{
    // Mark a browser compile as running for as long as `compile` is pending, so a tab that dies
    // during it is noticed on the next boot (see check_crashed_compile)
    in_flight += 1
    write_key(IN_FLIGHT_KEY, String(Date.now()))
    const done = () => {
        in_flight -= 1
        if (in_flight === 0){
            write_key(IN_FLIGHT_KEY, null)
        }
    }
    compile.then(done, done)
    return compile
}


// A page being left on purpose (the tab closed, a link followed, stored in the back/forward
// cache) fires pagehide, which a tab killed for using too much memory never gets to. So the
// marker is cleared then, and set again if the page comes back with a compile still running
addEventListener('pagehide', () => {
    write_key(IN_FLIGHT_KEY, null)
})
addEventListener('pageshow', () => {
    if (in_flight > 0){
        write_key(IN_FLIGHT_KEY, String(Date.now()))
    }
})


export function check_crashed_compile():void{
    // At boot, switch the device to the server if the last session's tab died mid-compile
    if (read_key(IN_FLIGHT_KEY) !== null){
        write_key(IN_FLIGHT_KEY, null)
        switch_to_server('crash')
    }
}
