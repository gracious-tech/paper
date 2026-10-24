
// Whether this device compiles in its own browser or leaves it to the server. Every device starts
// out compiling in the browser, and is switched to the server once it shows it can't cope — only
// by failures that are the device's own (see is_device_failure): running out of memory, being too
// slow, the engine failing to start, or the tab dying mid-compile, which on iOS gives no error to
// catch (the page just reloads), so it's noticed on the next boot from a marker left behind. An
// error in the Typst we generate, or a lost connection, says nothing about the device.
//
// Phones and desktops are treated differently, since a phone that can't cope can lose the user's
// tab, while a desktop that can't cope is only slow, and a desktop in server mode loses its live
// preview (the server only previews on request). So a phone switches on its first failure, and
// for good. A desktop is given more rope: a preview over DESKTOP_PREVIEW_TIMEOUT_MS has the
// server race it rather than replace it, and only a desktop the server keeps beating (or whose
// tab keeps dying) is switched, by strikes (see strike). Once switched, it tries its own browser
// again every so often beside the server's preview, and switches back as soon as it keeps up
// (see recheck_due), so an old laptop isn't written off by one bad day.
//
// A switch is provisional until the server has done the same kind of job (settle_server_mode):
// if the server fails it too, the fault was more likely the document or our own code than the
// device, which is switched back.
//
// The choice is this browser's alone, in localStorage: it's about the device, so it mustn't
// follow the account to another one.
//
// TODO(2027-02) Re-evaluate a phone's switch being permanent once there's data (the
// compile_stats rows below) and feedback: a phone may deserve another go after an app update
// lowers memory use, or after a month in case the phone or its browser was upgraded

import {ref} from 'vue'
import {collection, addDoc, serverTimestamp, Timestamp} from 'firebase/firestore'
import {COMPILE_STATS_LIFETIME_MS} from 'paper-bible-typst'

import {firestore} from '@/services/firebase'
import {user} from '@/services/auth'
import {is_mobile_now} from '@/services/display'


// How long a phone's preview may take in the browser before it's abandoned and the device
// switched to the server
export const PREVIEW_TIMEOUT_MS = 20 * 1000

// How long a desktop's live preview may take before the server is asked to race it. Shorter than
// a phone's, since a desktop recompiles as the user edits and is expected to keep up.
// TODO(2027-02) Reassess with the compile_stats rows, which time every browser preview
export const DESKTOP_PREVIEW_TIMEOUT_MS = 10 * 1000

// The longest a desktop's browser preview is let run at all, raced by the server or not
export const DESKTOP_PREVIEW_CAP_MS = 2 * 60 * 1000

// How many strikes switch a desktop to the server: the server beating its browser at a preview
// is one, the tab dying mid-compile two (it cost the user more, and is rarer), and a preview the
// browser finishes in time clears them all
const SWITCH_STRIKES = 3

// How many server previews a switched desktop waits before trying its own browser again, and the
// most that wait doubles to each time the browser still can't keep up
const RECHECK_FIRST = 20
const RECHECK_MAX = 160


// Why a device was switched to the server (recorded with the switch, see switch_to_server)
export type SwitchReason = 'crash'|'slow'|'memory'|'engine'


// A browser compile that ran out of memory: the WASM heap trapped, and did so again on a fresh
// worker (see send_compile in typst.ts), so the document is more than this device can hold
export class BrowserMemoryError extends Error {}

// A browser compile abandoned for taking too long (see within_timeout)
export class SlowCompileError extends Error {}


// localStorage keys: the device's mode ('1' once confirmed, 'provisional' until then), when a
// compile on it began while one is running, a desktop's strikes, and a switched desktop's re-check
// countdown ({left, interval} as JSON)
const MODE_KEY = 'compile_on_server'
const IN_FLIGHT_KEY = 'compile_in_flight'
const STRIKES_KEY = 'compile_strikes'
const RECHECK_KEY = 'compile_recheck'


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
    write_key(STRIKES_KEY, null)
    write_key(RECHECK_KEY, JSON.stringify({left: RECHECK_FIRST, interval: RECHECK_FIRST}))
    record_mode('compile_mode', reason)
}


function switch_to_browser(reason:'server_failed'|'recheck'):void{
    // Have this device compile in its own browser again, with a clean slate
    server_mode.value = false
    provisional = false
    write_key(MODE_KEY, null)
    write_key(STRIKES_KEY, null)
    write_key(RECHECK_KEY, null)
    record_mode('compile_mode_reverted', reason)
}


export function strike(reason:'slow'|'crash'):void{
    // Count a desktop's failure towards switching it to the server (see SWITCH_STRIKES)
    const strikes = Number(read_key(STRIKES_KEY) ?? 0) + (reason === 'crash' ? 2 : 1)
    if (strikes >= SWITCH_STRIKES){
        switch_to_server(reason)
    } else {
        write_key(STRIKES_KEY, String(strikes))
    }
}


export function clear_strikes():void{
    // A browser preview finished in time, so whatever went wrong before was a blip
    write_key(STRIKES_KEY, null)
}


export function recheck_due():boolean{
    // Whether a desktop in server mode should try its own browser beside this server preview
    // (see recheck_passed/recheck_failed), counting this preview towards the next re-check
    if (!server_mode.value || is_mobile_now()){
        return false
    }
    let state = {left: RECHECK_FIRST, interval: RECHECK_FIRST}
    try {
        state = {...state, ...JSON.parse(read_key(RECHECK_KEY) ?? '{}') as typeof state}
    } catch {
        // A garbled countdown just starts again
    }
    state.left -= 1
    write_key(RECHECK_KEY, JSON.stringify(state))
    return state.left <= 0
}


export function recheck_passed():void{
    // The browser kept up on a re-check, so the device compiles there again
    switch_to_browser('recheck')
}


export function recheck_failed():void{
    // The browser still couldn't keep up on a re-check: wait twice as long for the next one
    let interval = RECHECK_FIRST
    try {
        interval = (JSON.parse(read_key(RECHECK_KEY) ?? '{}') as {interval?:number}).interval
            ?? RECHECK_FIRST
    } catch {
        // As in recheck_due
    }
    interval = Math.min(interval * 2, RECHECK_MAX)
    write_key(RECHECK_KEY, JSON.stringify({left: interval, interval}))
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
    if (server_ok){
        provisional = false
        write_key(MODE_KEY, '1')
    } else {
        switch_to_browser('server_failed')
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
    // At boot, notice the last session's tab dying mid-compile: a phone is switched to the server
    // there and then, a desktop takes strikes (see strike)
    if (read_key(IN_FLIGHT_KEY) !== null){
        write_key(IN_FLIGHT_KEY, null)
        if (is_mobile_now()){
            switch_to_server('crash')
        } else {
            strike('crash')
        }
    }
}
