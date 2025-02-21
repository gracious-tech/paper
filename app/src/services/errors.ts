/* GENERIC ERROR REPORTING

With support for Vue 3 and Rollbar
Version 1.0 (21 Feb 2025)

How to integrate:
    1. Import whole module and styles before anything else to trigger listeners
        import '@/services/errors.sass'
        import '@/services/errors'
    2. Import handler for Vue separate to above
        import {vue_error_handler} from '@/services/errors'
        app.config.errorHandler = vue_error_handler
    3. Set VITE_ROLLBAR_TOKEN in production env file (not required for dev)
*/


// CONFIG


// List of keywords that if present anywhere in an error message, should ignore
const ignore_errors = [
    '@safari-extension://',
    // Waiting on https://github.com/jakearchibald/idb/issues/245
    'IDBFactory.open() called in an invalid security context',
]


// STATE


// Require a somewhat modern browser (may not actually use CSS grid)
const browser_supported = !! (CSS && CSS.supports && CSS.supports('grid-template-rows', 'none'))

// Mark start time so know runtime when errors occur
const start_ms = new Date().getTime()

// Preserve time of last error report so can throttle them
let last_error_report = 0  // i.e. 1970

// Track whether showing error, to avoid showing multiple
let fail_displayed:null|'banner'|'splash' = null


// UTILS


function rollbar(message:string):string{
    // Send an error report to Rollbar
    // NOTE Not using Rollbar's own SDK as it is too large and unnecessary

    // Generate URL-safe base64 uuid for report (15 bytes = 20 chars)
    const uuid = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(15))))
        .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '~')

    // Send to localhost during dev so can inspect the request but not actually do anything
    const url = import.meta.env.PROD
        ? 'https://api.rollbar.com/api/1/item/' : 'http://localhost:7777/'

    // Consider critical if happens on first load
    const now_ms = new Date().getTime()
    const ms_since_load = now_ms - start_ms
    const critical = ms_since_load < (3 * 1000)

    void fetch(url, {
        method: 'POST',
        body: JSON.stringify({
            access_token: import.meta.env['VITE_ROLLBAR_TOKEN'],
            data: {
                environment: import.meta.env.MODE,
                platform: 'browser',
                language: 'javascript',
                level: critical ? 'critical' : 'error',
                uuid: uuid,
                timestamp: Math.round(now_ms / 1000),  // In secs
                request: {
                    url: location.href,
                    user_ip: '$remote_ip',  // Rollbar will set from requests' IP
                },
                client: {
                    runtime_ms: ms_since_load,
                    javascript: {
                        browser: navigator.userAgent,
                        language: navigator.language,
                    },
                },
                body: {
                    message: {
                        body: message,
                    },
                },
            },
        }),
    }).catch(() => undefined)  // WARN Prevent recursive errors due to failed report

    return uuid
}


function show_error_msg(type:'banner'|'splash', debug=''):void{
    // Insert an error banner or splash into the DOM
    fail_displayed = type
    document.body.insertAdjacentHTML('afterbegin', `
        <div class="fail-${type}">
            <h1>Something went wrong</h1>
            <p>
                <a href='https://gracious.tech/contact?desc=${encodeURIComponent(debug)}'
                    target='_blank'>Let us know</a>
            </p>
            <button>RELOAD</button>
        </div>
    `)
    ;(document.querySelector(`.fail-${type} button`) as HTMLButtonElement)
        .addEventListener('click', () => {location.reload()})
}


function show_unsupported():void{
    // Show unsupported browser splash msg
    // NOTE This is only intended to work for modern-ish old browsers (ancient ones just ignore)
    fail_displayed = 'splash'
    document.body.insertAdjacentHTML('afterbegin', `
        <div class="fail-splash">
            <h1>Sorry, your browser is too old</h1>
            <p>Please update your browser or use another browser</p>
        </div>
    `)
}


// EXPORTED

export function report_error(type:'silent'|'banner'|'splash', error:unknown, force=false):void{
    // Report an error

    // Convert to a string if not already
    const error_str = error_to_string(error)

    // Ignore certain errors
    for (const code of ignore_errors){
        if (error_str.includes(code) && !force){
            return
        }
    }

    // Don't report if browser not supported, as not actionable
    if (!browser_supported){
        show_unsupported()
        return
    }

    // Send report (throttled)
    const now = new Date().getTime()
    let uuid = ''
    if ((now - last_error_report) > 3000 || force){
        uuid = rollbar(error_str)
        last_error_report = now
    }

    // Optionally show visual warning
    const error_id = self.location.hostname + ' ' + uuid
    if (type === 'banner' && !fail_displayed){
        show_error_msg('banner', error_id)
    } else if (type === 'splash' && fail_displayed !== 'splash'){
        show_error_msg('splash', error_id)
    }
}


export function vue_error_handler(error:unknown, instance:unknown, info:string){
    // Vue will by default just log component errors, but many can actually be critical to UI
    // NOTE Vue's warnHandler doesn't function during production so ignore it
    // NOTE Vue's info arg says what part of Vue the error occured in (e.g. render/hook/etc)
    const details = `${error_to_string(error)}\n\n(Error in Vue ${info})`

    // Log and show banner
    console.error(details)
    report_error('banner', details)
}


export function error_to_string(error:unknown):string{
    // Since thrown errors can be any object in JS, need to carefully extract info from them

    if (typeof error === 'string'){
        return error
    }

    // Determine type of error (useful for knowing why can't extract more info from e.g. a string)
    // NOTE Constructor name important for custom error classes (3rd party or own) which may not
    //      inherit from Error properly
    let type:string = typeof error
    if (type === 'object'){
        type = (error as object)?.constructor?.name || 'object'
    }

    // Try get more info
    let info = ''
    try {
        if (error instanceof Error){
            // NOTE `error.name` will be same as constructor name already included above
            info = `${error.message}\n\n${error.stack!}`
        } else if (typeof error === 'object'){
            info = JSON.stringify(error, undefined, 4)
        } else {
            info = String(error)
        }
    } catch {
        // Never fail
    }

    return `Error type: ${type}\n${info}`
}


// LISTENERS

addEventListener('error', (event:ErrorEvent):void => {
    // Handle uncaught errors
    const error:unknown = event.error ?? event.message ?? 'unknown'
    console.error(error)
    report_error('banner', error)
})


addEventListener('unhandledrejection', event => {
    // Report uncaught errors in promises
    report_error('banner', event.reason)
})


addEventListener('securitypolicyviolation', event => {
    // Report CSP issues
    const msg = `CSP error: ${event.blockedURI} violated ${event.violatedDirective}`
    console.error(event)
    report_error('silent', msg)
})


// Expose `report_error` so can test in console
// @ts-ignore
self.report_error = report_error
