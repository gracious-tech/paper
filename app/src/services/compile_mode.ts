
// Whether this device compiles in its own browser or leaves it to the server. Desktop always
// compiles in the browser, where the live preview needs it. A phone starts out doing the same,
// but is switched to the server for good once it shows it can't cope: a preview taking too long
// (see PREVIEW_TIMEOUT_MS), or the tab dying mid-compile, which on iOS gives no error to catch
// (the page just reloads), so it's noticed on the next boot from a marker left behind.
//
// The choice is this browser's alone, in localStorage: it's about the device, so it mustn't
// follow the account to a desktop.
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


// localStorage keys: the device's mode, and when a compile on it began while one is running
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


// Whether this device has been switched to compiling on the server
export const server_mode = ref(read_key(MODE_KEY) === '1')


export function compiles_on_server():boolean{
    // Whether a compile asked for now should go to the server rather than this browser: only
    // ever on a phone (below the mobile breakpoint) that has been switched
    return server_mode.value && is_mobile_now()
}


export function switch_to_server(reason:'crash'|'slow'):void{
    // Send this device's compiles to the server from now on, recording why for the decision
    // above (best-effort: telemetry never matters more than the switch itself)
    if (server_mode.value){
        return
    }
    server_mode.value = true
    write_key(MODE_KEY, '1')
    if (user.value){
        void addDoc(collection(firestore, 'compile_stats'), {
            kind: 'compile_mode', reason, owner: user.value.uid, created: serverTimestamp(),
            expires: Timestamp.fromMillis(Date.now() + COMPILE_STATS_LIFETIME_MS),
            user_agent: navigator.userAgent,
        }).catch(() => undefined)
    }
}


// How many browser compiles are running on this phone right now (see track_browser_compile)
let in_flight = 0


export function track_browser_compile<T>(compile:Promise<T>):Promise<T>{
    // Mark a browser compile as running for as long as `compile` is pending, so a tab that dies
    // during it is noticed on the next boot (see check_crashed_compile). Phones only: a desktop
    // crash says nothing about the phone flow this decides
    if (!is_mobile_now()){
        return compile
    }
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
