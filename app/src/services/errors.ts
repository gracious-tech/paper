/* GENERIC ERROR REPORTING

Reports are POSTed to the app's own /api/report_error endpoint, which records the caller's IP
and stores them in the Storage bucket as errors/{fingerprint}/{id}.json (see server/src/errors.ts;
triage them with .bin/errors)

How to integrate:
    1. Import whole module and styles before anything else to trigger listeners
        import '@/services/errors.sass'
        import '@/services/errors'
    2. Import handler for Vue separate to above
        import {vue_error_handler} from '@/services/errors'
        app.config.errorHandler = vue_error_handler
    3. Once auth is ready, provide a token getter so reports include the user's uid
        set_error_auth(async () => await firebase_auth.currentUser?.getIdToken() ?? null)
*/


// CONFIG


// List of keywords that if present anywhere in an error message, should ignore
const ignore_errors = [
    '@safari-extension://',
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

// Getter for the current user's ID token, set via `set_error_auth()` once firebase is ready
// (this module must stay import-first and dependency-free, so it can't import auth itself)
let auth_token_getter:(() => Promise<string|null>)|null = null


// UTILS


function save_error(message:string, severity:'critical'|'error',
        context?:Record<string, string|number>):string{
    // Send an error report to the server (which stores it in the bucket with the caller's IP)
    // NOTE Fire-and-forget — the report's id is returned immediately for use in support links

    // Generate URL-safe base64 id for report (15 bytes = 20 chars)
    const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(15))))
        .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '~')

    void (async () => {
        const token = await auth_token_getter?.().catch(() => null) ?? null
        await fetch('/api/report_error', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? {'Authorization': `Bearer ${token}`} : {}),
            },
            body: JSON.stringify({
                id,
                severity,
                message,
                url: location.href,
                language: navigator.language,
                runtime_ms: new Date().getTime() - start_ms,
                context,
            }),
        })
    })().catch(() => undefined)  // WARN Prevent recursive errors due to failed report

    return id
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


export function set_error_auth(getter:() => Promise<string|null>):void{
    // Provide a token getter so error reports carry the user's uid (set once auth initialised)
    auth_token_getter = getter
}


export function report_error(type:'silent'|'banner'|'splash', error:unknown,
        options:{force?:boolean, critical?:boolean, context?:Record<string, string|number>} = {})
        :string{
    // Report an error, returning the report's id ('' if not reported)

    // Convert to a string if not already
    const error_str = error_to_string(error)

    // Always log to console, regardless of whether actually reported below (so devtools/CLI
    // output never silently drops an error just because it was throttled/ignored/silent-type)
    console.error(error_str)

    // Ignore certain errors
    for (const code of ignore_errors){
        if (error_str.includes(code) && !options.force){
            return ''
        }
    }

    // Don't report if browser not supported, as not actionable
    if (!browser_supported){
        show_unsupported()
        return ''
    }

    // Visible failures mean the app is broken for the user, so they (and anything explicitly
    // flagged, like a document that couldn't be generated) are critical
    const severity = type !== 'silent' || options.critical ? 'critical' : 'error'

    // Send report (throttled)
    const now = new Date().getTime()
    let error_id = ''
    if ((now - last_error_report) > 3000 || options.force){
        error_id = save_error(error_str, severity, options.context)
        last_error_report = now
    }

    // Optionally show visual warning (debug string ends up in the support contact link)
    const debug = `${self.location.hostname} error:${error_id}\n${error_str.slice(0, 300)}`
    if (type === 'banner' && !fail_displayed){
        show_error_msg('banner', debug)
    } else if (type === 'splash' && fail_displayed !== 'splash'){
        show_error_msg('splash', debug)
    }

    return error_id
}


export function vue_error_handler(error:unknown, instance:unknown, info:string){
    // Vue will by default just log component errors, but many can actually be critical to UI
    // NOTE Vue's warnHandler doesn't function during production so ignore it
    // NOTE Vue's info arg says what part of Vue the error occured in (e.g. render/hook/etc)
    const details = `${error_to_string(error)}\n\n(Error in Vue ${info})`

    // Show banner (also logs to console)
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
    report_error('banner', error)
})


addEventListener('unhandledrejection', event => {
    // Report uncaught errors in promises
    report_error('banner', event.reason)
})


addEventListener('securitypolicyviolation', event => {
    // Report CSP issues
    const msg = `CSP error: ${event.blockedURI} violated ${event.violatedDirective}`
    report_error('silent', msg)
})


// Expose `report_error` so can test in console
// @ts-ignore
self.report_error = report_error
