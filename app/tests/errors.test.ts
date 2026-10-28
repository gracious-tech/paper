
// Error reporting: what an error becomes as a report, which errors are never sent (ignored
// messages, crawlers, unsupported browsers, cancelled requests, extensions' CSP violations), the
// throttle, and what a stored report may carry of the page's URL. The module reads the browser
// at import and registers its listeners on `self`, so each test loads a fresh copy against
// stubbed globals, with the listeners captured to be fired by hand

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// A report as the module POSTs it to /api/report_error
interface SentReport {
    id:string
    severity:string
    message:string
    url:string
    language:string
    context?:Record<string, string|number>
}


// The listeners the module registered, by event type
let listeners:Record<string, (event:unknown) => void> = {}

// Every request made to fetch (only reports are ever sent)
let fetch_mock:ReturnType<typeof vi.fn>

// Elements the fake document was asked to show, newest first
let shown:FakeElement[] = []

// The page's URL, as location.href reports it
const PAGE = 'https://paper.bible/designs/abc'


// Just enough of an element for the failure splash: its text, attributes and children
class FakeElement {
    textContent = ''
    className = ''
    href = ''
    children:FakeElement[] = []
    html = ''
    constructor(public tag:string){}
    append(...children:FakeElement[]){
        this.children.push(...children)
    }
    addEventListener(){}
    // All the text below this element, children included
    all_text():string{
        return [this.textContent, this.html, ...this.children.map(child => child.all_text())]
            .join(' ')
    }
}


// Load a fresh copy of the module against stubbed browser globals
async function load_errors(options:{user_agent?:string, supported?:boolean} = {}){
    listeners = {}
    shown = []
    fetch_mock = vi.fn(() => Promise.resolve(new Response()))
    vi.stubGlobal('self', globalThis)
    vi.stubGlobal('CSS', {supports: () => options.supported ?? true})
    vi.stubGlobal('Worker', class {})
    vi.stubGlobal('navigator', {userAgent: options.user_agent ?? 'Mozilla/5.0 Firefox/130.0',
        language: 'en-AU'})
    vi.stubGlobal('location', {href: PAGE, hostname: 'paper.bible'})
    vi.stubGlobal('fetch', fetch_mock)
    vi.stubGlobal('addEventListener', (type:string, listener:(event:unknown) => void) => {
        listeners[type] = listener
    })
    vi.stubGlobal('document', {
        createElement: (tag:string) => new FakeElement(tag),
        body: {
            prepend: (element:FakeElement) => {shown.unshift(element)},
            insertAdjacentHTML: (_where:string, html:string) => {
                const element = new FakeElement('div')
                element.html = html
                shown.unshift(element)
            },
        },
    })
    vi.resetModules()
    return await import('@/services/errors')
}


// The reports sent so far, once the module's fire-and-forget sends have run
async function sent_reports():Promise<SentReport[]>{
    await new Promise(resolve => setTimeout(resolve, 0))
    return fetch_mock.mock.calls.map(call =>
        JSON.parse((call[1] as {body:string}).body) as SentReport)
}


// Keep the console quiet: every reported error is also logged
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
})


describe('error_to_string', () => {

    it('passes strings through as they are', async () => {
        const {error_to_string} = await load_errors()
        expect(error_to_string('plain message')).toBe('plain message')
    })

    it('gives an Error\'s class, message and stack', async () => {
        const {error_to_string} = await load_errors()
        // A subclass names itself, which is how custom errors are told apart in triage
        class QuotaError extends Error {}
        const error = new QuotaError('Over the limit')
        const text = error_to_string(error)
        expect(text.startsWith('Error type: QuotaError\nOver the limit\n\n')).toBe(true)
        expect(text).toContain(error.stack)
    })

    it('reads message and stack from an error of another realm', async () => {
        const {error_to_string} = await load_errors()
        // Fails `instanceof Error`, and its message isn't enumerable, so JSON would give '{}'
        const foreign = Object.create(null) as Record<string, unknown>
        Object.defineProperty(foreign, 'message', {value: 'From an iframe'})
        Object.defineProperty(foreign, 'stack', {value: 'at frame.js:1'})
        expect(error_to_string(foreign))
            .toBe('Error type: object\nFrom an iframe\n\nat frame.js:1')
    })

    it('shows a plain object as JSON', async () => {
        const {error_to_string} = await load_errors()
        expect(error_to_string({code: 'not-found', status: 404}))
            .toBe('Error type: Object\n{\n    "code": "not-found",\n    "status": 404\n}')
    })

    it('says what an object with nothing enumerable was', async () => {
        const {error_to_string} = await load_errors()
        expect(error_to_string({})).toBe(
            'Error type: Object\n{} (own keys: none; as string: [object Object])')
        // Own but non-enumerable keys are listed, so the object can still be recognised
        class Event {toString(){ return 'an event' }}
        const event = new Event()
        Object.defineProperty(event, 'target', {value: 'x', enumerable: false})
        expect(error_to_string(event)).toBe(
            'Error type: Event\n{} (own keys: target; as string: an event)')
    })

    it('stringifies other throwables, and never throws itself', async () => {
        const {error_to_string} = await load_errors()
        expect(error_to_string(42)).toBe('Error type: number\n42')
        expect(error_to_string(undefined)).toBe('Error type: undefined\nundefined')
        expect(error_to_string(null)).toBe('Error type: object\nnull')
        // JSON.stringify throws on a cycle; the type alone is still given
        const cyclic:Record<string, unknown> = {}
        cyclic['self'] = cyclic
        expect(error_to_string(cyclic)).toBe('Error type: Object\n')
    })

})


describe('report_error', () => {

    it('sends a report and returns its id', async () => {
        const {report_error} = await load_errors()
        const id = report_error('silent', 'Something broke', {context: {step: 'compile'}})
        expect(id).toMatch(/^[\w~-]{20}$/)
        const [report] = await sent_reports()
        expect(report).toMatchObject({id, severity: 'error', message: 'Something broke',
            language: 'en-AU', context: {step: 'compile'}})
        expect(fetch_mock.mock.calls[0]![0]).toBe('/api/report_error')
    })

    it('marks what the user saw as critical', async () => {
        const {report_error} = await load_errors()
        report_error('silent', 'Banner shown', {critical: true})
        const [report] = await sent_reports()
        expect(report!.severity).toBe('critical')
    })

    it('sends the uid\'s token once auth is set, and survives the getter failing', async () => {
        const errors = await load_errors()
        errors.set_error_auth(() => Promise.resolve('token-123'))
        errors.report_error('silent', 'With auth', {force: true})
        errors.set_error_auth(() => Promise.reject(new Error('Auth gone')))
        errors.report_error('silent', 'Without auth', {force: true})
        await sent_reports()
        const headers = fetch_mock.mock.calls.map(call =>
            (call[1] as {headers:Record<string, string>}).headers)
        expect(headers[0]!['Authorization']).toBe('Bearer token-123')
        expect(headers[1]!['Authorization']).toBe(undefined)
    })

    it('ignores known noise unless forced', async () => {
        const {report_error} = await load_errors()
        expect(report_error('silent', 'Database deleted by request of the user')).toBe('')
        expect(report_error('silent', new Error('at @safari-extension://x/y.js'))).toBe('')
        expect(await sent_reports()).toEqual([])
        expect(report_error('silent', 'Database deleted by request of the user', {force: true}))
            .not.toBe('')
    })

    it('throttles reports to one per 3 seconds, unless forced', async () => {
        vi.useFakeTimers({toFake: ['Date']})
        vi.setSystemTime(10_000)
        const {report_error} = await load_errors()
        expect(report_error('silent', 'First')).not.toBe('')
        expect(report_error('silent', 'Second')).toBe('')
        expect(report_error('silent', 'Forced', {force: true})).not.toBe('')
        vi.setSystemTime(13_001)
        expect(report_error('silent', 'Later')).not.toBe('')
        const messages = (await sent_reports()).map(report => report.message)
        expect(messages).toEqual(['First', 'Forced', 'Later'])
    })

    it('reports nothing from crawlers, though a phone named like a bot still reports', async () => {
        const crawler = await load_errors({user_agent:
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'})
        expect(crawler.report_error('splash', 'Boot failed')).toBe('')
        expect(shown).toEqual([])
        const phone = await load_errors({user_agent: 'Mozilla/5.0 (Linux; Android 10; Cubot X30)'})
        expect(phone.report_error('silent', 'Real failure')).not.toBe('')
    })

    // TODO Fails: show_unsupported() runs at import before `let splash_displayed` is initialised,
    //      so the module throws a ReferenceError instead of showing the message
    it.fails('shows unsupported browsers the too-old message instead of reporting', async () => {
        const {report_error} = await load_errors({supported: false})
        // Shown at import already, before anything has failed
        expect(shown[0]!.all_text()).toContain('your browser is too old')
        expect(report_error('splash', 'Boot failed')).toBe('')
        expect(await sent_reports()).toEqual([])
    })

    it('shows the failure splash once, translated when it can be', async () => {
        const errors = await load_errors()
        errors.set_error_translator(key => `[${key}]`)
        const id = errors.report_error('splash', 'Boot failed', {message: 'Try again later'})
        expect(shown).toHaveLength(1)
        const text = shown[0]!.all_text()
        expect(text).toContain('[app.error_title]')
        expect(text).toContain('Try again later')
        // The support link carries the report id and the error, encoded
        const link = shown[0]!.children.flatMap(child => child.children)
            .find(child => child.tag === 'a')
        expect(decodeURIComponent(link!.href)).toContain(`paper.bible error:${id}\nBoot failed`)
        expect((await sent_reports())[0]!.severity).toBe('critical')

        errors.report_error('splash', 'Failed again', {force: true})
        expect(shown).toHaveLength(1)
    })

    it('reports Vue errors with where in Vue they happened', async () => {
        const {vue_error_handler} = await load_errors()
        vue_error_handler(new Error('Render failed'), null, 'render function')
        const [report] = await sent_reports()
        expect(report!.message).toContain('Render failed')
        expect(report!.message).toContain('(Error in Vue render function)')
    })

})


describe('the url a report keeps', () => {

    // The url of the report sent from a page at `href`
    async function url_reported_from(href:string):Promise<string>{
        const {report_error} = await load_errors()
        vi.stubGlobal('location', {href, hostname: 'paper.bible'})
        report_error('silent', 'Anything', {force: true})
        return (await sent_reports())[0]!.url
    }

    it('drops the query and fragment, where sign-in codes travel', async () => {
        expect(await url_reported_from('https://paper.bible/designs?oobCode=secret#x'))
            .toBe('https://paper.bible/designs')
    })

    it('masks a design invite\'s token, which grants edit access', async () => {
        expect(await url_reported_from('https://paper.bible/designs/abc/invite/TOKEN123'))
            .toBe('https://paper.bible/designs/abc/invite/~')
    })

    it('keeps nothing of a url that won\'t parse', async () => {
        expect(await url_reported_from('not a url')).toBe('')
    })

})


describe('uncaught errors', () => {

    // An ErrorEvent as far as the listener reads it
    function error_event(fields:{error?:unknown, message?:string, filename?:string}){
        return {error: null, message: '', filename: '', ...fields}
    }

    it('reports uncaught errors and rejections', async () => {
        vi.useFakeTimers({toFake: ['Date']})
        vi.setSystemTime(10_000)
        await load_errors()
        listeners['error']!(error_event({error: new Error('Uncaught one')}))
        // Past the throttle, so the second is sent too
        vi.setSystemTime(20_000)
        listeners['unhandledrejection']!({reason: new Error('Rejected one')})
        const messages = (await sent_reports()).map(report => report.message)
        expect(messages).toHaveLength(2)
        expect(messages[0]).toContain('Uncaught one')
        expect(messages[1]).toContain('Rejected one')
    })

    it('falls back to the event\'s message when there\'s no error object', async () => {
        await load_errors()
        listeners['error']!(error_event({message: 'Something odd'}))
        expect((await sent_reports())[0]!.message).toBe('Something odd')
    })

    it('ignores what isn\'t a failure of the app\'s own code', async () => {
        await load_errors()
        const abort = new DOMException('The operation was aborted', 'AbortError')
        listeners['error']!(error_event({message: 'ResizeObserver loop completed with undelivered'
            + ' notifications.'}))
        listeners['error']!(error_event({message: 'Script error.'}))
        // Inline script, whose source is the page itself
        listeners['error']!(error_event({error: new Error('Injected'), filename: `${PAGE}#top`}))
        listeners['error']!(error_event({error: abort}))
        listeners['unhandledrejection']!({reason: abort})
        expect(await sent_reports()).toEqual([])
    })

})


describe('CSP violations', () => {

    // A violation event as far as the listener reads it
    function violation(fields:Partial<Record<'blockedURI'|'sourceFile'|'effectiveDirective',
            string>>){
        return {blockedURI: 'https://evil.example/x.js', sourceFile: 'https://paper.bible/a.js',
            effectiveDirective: 'script-src-elem', violatedDirective: 'script-src',
            lineNumber: 3, sample: '', ...fields}
    }

    it('reports a violation once per page load, with its detail as context', async () => {
        vi.useFakeTimers({toFake: ['Date']})
        vi.setSystemTime(10_000)
        await load_errors()
        listeners['securitypolicyviolation']!(violation({}))
        vi.setSystemTime(20_000)
        listeners['securitypolicyviolation']!(violation({}))
        const reports = await sent_reports()
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({
            message: 'CSP error: https://evil.example/x.js violated script-src',
            context: {source_file: 'https://paper.bible/a.js', line: 3},
        })
    })

    it('ignores extensions and Google\'s tracking pixel', async () => {
        await load_errors()
        const fire = listeners['securitypolicyviolation']!
        fire(violation({blockedURI: 'chrome-extension'}))
        fire(violation({sourceFile: 'moz-extension://abc/content.js'}))
        fire(violation({sourceFile: 'webkit-masked-url://hidden/'}))
        fire(violation({sourceFile: 'sandbox eval code'}))
        fire(violation({blockedURI: 'https://www.google.com/images/cleardot.gif'}))
        fire(violation({blockedURI: 'https://apis.google.com/js/gen_204?x=1'}))
        expect(await sent_reports()).toEqual([])
    })

})
