/* GENERIC ERROR REPORTING

Reports are POSTed to the app's own /api/report_error endpoint, which records the caller's IP
and stores them in the Storage bucket as errors/{fingerprint}/{id}.json (see server/src/errors.ts;
triage them with .bin/errors)

How to integrate:
    1. Import whole module and styles before anything else to trigger listeners
        import '@/services/errors.sss'
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


// Crawler user agents, whose failures are never actionable (e.g. Googlebot's renderer doesn't
// complete the anonymous sign-in request, so boot fails every time it indexes a page). Matched on
// a versioned `bot/` token (Googlebot/2.1, bingbot/2.0, AhrefsBot/7.0...) or the `+http` info
// link most crawlers carry — not a bare "bot", which also matches phone brands like Cubot
const crawler_ua = /bot\/|crawler|spider|\+https?:\/\//i


// STATE


function detect_browser_support():boolean{
    // Whether this browser can actually run paper.bible, not just parse its JS. CSS grid is a
    // cheap proxy for "modern enough" that catches ancient/oddball browsers outright (IE11, old
    // WebViews); WebAssembly and Worker are what the Typst engine itself needs (compile/cover
    // workers are module workers specifically, but that's been supported everywhere Worker and
    // WebAssembly are — including Firefox — since 2023, so it's not worth testing separately);
    // and the Web Crypto API is needed for asset hashing (content_images.ts, cover.ts)
    if (!(CSS && CSS.supports && CSS.supports('grid-template-rows', 'none'))){
        return false
    }
    if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined'){
        return false
    }
    return !! self.crypto?.subtle
}


// Require a somewhat modern browser
const browser_supported = detect_browser_support()

// Show the unsupported-browser splash immediately rather than waiting for some later feature to
// actually fail and trip an error report first (`show_unsupported` is defined further down, but
// function declarations are hoisted so calling it here is fine)
if (!browser_supported){
    show_unsupported()
}

// Whether this visitor is a crawler rather than a person
const is_crawler = crawler_ua.test(navigator.userAgent)

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


function safe_url(href:string):string{
    // Reduce the current page's URL to something safe to keep in a stored report. The query
    // string and fragment go wholesale — a passwordless sign-in link carries its single-use
    // code there, and nothing in a query is worth triaging — and a design invite link's token
    // is masked out of the path, since it grants edit access to whoever reads it
    try {
        const url = new URL(href)
        return url.origin + url.pathname.replace(/(\/invite\/)[^/]+/, '$1~')
    } catch {
        return ''
    }
}


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
                url: safe_url(location.href),
                language: navigator.language,
                runtime_ms: new Date().getTime() - start_ms,
                build: import.meta.env.BUILD_COMMIT,
                context,
            }),
        })
    })().catch(() => undefined)  // WARN Prevent recursive errors due to failed report

    return id
}


function make_element<K extends keyof HTMLElementTagNameMap>(tag:K, text = '')
        :HTMLElementTagNameMap[K]{
    // Create an element holding plain text (never parsed as HTML)
    const element = document.createElement(tag)
    element.textContent = text
    return element
}


function show_error_msg(type:'banner'|'splash', debug=''):void{
    // Insert an error banner or splash into the DOM. Built element by element rather than from
    // an HTML string: `debug` carries the error message, which can quote a shared design's
    // content, and URL-encoding alone leaves quotes that could break out of an attribute
    fail_displayed = type
    const container = make_element('div')
    container.className = `fail-${type}`
    const link = make_element('a', "Let us know")
    link.href = `https://gracious.tech/contact?desc=${encodeURIComponent(debug)}`
    link.target = '_blank'
    link.rel = 'noopener'
    const paragraph = make_element('p')
    paragraph.append(link)
    const button = make_element('button', "RELOAD")
    button.addEventListener('click', () => {location.reload()})
    container.append(make_element('h1', "Something went wrong"), paragraph, button)
    document.body.prepend(container)
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

    // Don't report crawlers' errors, nor show them a failure message that would then be indexed
    // as the page's content
    if (is_crawler && !options.force){
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

// Tell public/boot_check.js the bundle is running, so it leaves errors from here on to below
;(self as unknown as {app_errors_ready:boolean}).app_errors_ready = true


addEventListener('error', (event:ErrorEvent):void => {
    // Handle uncaught errors
    const error:unknown = event.error ?? event.message ?? 'unknown'
    report_error('banner', error)
})


addEventListener('unhandledrejection', event => {
    // Report uncaught errors in promises
    report_error('banner', event.reason)
})


// URLs belonging to a browser extension: blockedURI reports a non-network URL as its bare scheme
// (e.g. "chrome-extension"), and Safari masks extension script locations as webkit-masked-url
const extension_schemes = ['chrome-extension', 'moz-extension', 'safari-extension',
    'safari-web-extension', 'ms-browser-extension', 'webkit-masked-url']
const extension_url = new RegExp(`^(${extension_schemes.join('|')})(:|$)`)

// Violations already reported this page load (directive + blocked URL + source), so a blocked
// resource that keeps retrying, or an extension re-injecting on every render, reports once
const reported_violations = new Set<string>()


addEventListener('securitypolicyviolation', event => {
    // Ignore Firebase Auth's cleardot.gif tracking pixel, a known benign img-src violation from
    // Google's own gapi plumbing that isn't worth allowlisting
    if (event.blockedURI.includes('google.com/images/cleardot.gif')) {
        return
    }

    // Ignore what an extension caused, when the browser attributes it: the blocked resource or
    // the script that triggered the violation lives in an extension. Extensions that inject
    // inline script into the page itself aren't attributed, so those still arrive, with
    // `sample` showing what the script was
    if (extension_url.test(event.blockedURI) || extension_url.test(event.sourceFile)){
        return
    }

    // Once per distinct violation per page load
    const key = `${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}`
    if (reported_violations.has(key)){
        return
    }
    reported_violations.add(key)

    // Report, keeping the message itself stable so repeats share a fingerprint; the detail goes
    // in context (`sample` is the blocked inline code's opening, sent due to 'report-sample')
    const msg = `CSP error: ${event.blockedURI} violated ${event.violatedDirective}`
    report_error('silent', msg, {context: {
        source_file: event.sourceFile.slice(0, 300),
        line: event.lineNumber,
        sample: event.sample.slice(0, 100),
    }})
})


// Expose `report_error` so can test in console
// @ts-ignore
self.report_error = report_error
