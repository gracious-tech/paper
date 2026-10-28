// The app's UI state helpers (state.ts) — the real module, imported by path since the suites alias
// `@/services/state` to a stub: telling the user something failed (and reporting it), the
// once-only welcome splash, retrying a server action until the user gives up, the dialogs those
// open, and the copyright/red-letter questions asked of the open design

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {content, reset_content} from './stubs/content'
import {make_blueprint} from './helpers/blueprint'


// Reports filed, as (type, error, options)
const report_error = vi.hoisted(() => vi.fn())
vi.mock('@/services/errors', () => ({report_error}))

// The two API failures the helpers treat specially (the real module reaches Firebase at import)
vi.mock('@/services/api', () => ({
    ApiOfflineError: class extends Error {},
    ApiSessionError: class extends Error {},
}))

import {ApiOfflineError, ApiSessionError} from '@/services/api'
import {blue, confirm_dialog, doc_dir, estimated_pages, has_copyright, page_count_guess,
    print_service_warning_dialog, prompt_dialog, report_failure, requires_copyright,
    run_with_retry, set_welcome_seen, state, supports_wj, welcome_seen}
    from '../src/services/state'

import type {ContentCustom} from '@/services/types'


// A custom page whose text is just the copyright marker, or plain text
function custom_page(copyright:boolean):ContentCustom{
    return {type: 'custom', id: 'c1', name: 'Page', doc: {type: 'doc', content: [
        {type: 'paragraph', content: [{type: 'text', text: copyright ? 'AUTO-COPYRIGHT' : 'Hi'}]},
    ]}} as unknown as ContentCustom
}

// Answer the alert dialog currently showing, as the user would
async function answer_alert(did_action:boolean):Promise<string>{
    await vi.waitFor(() => expect(state.alert).not.toBe(null))
    const {message, resolve} = state.alert!
    state.alert = null
    resolve(did_action)
    return message
}


beforeEach(() => {
    vi.clearAllMocks()
    state.toast = null
    state.alert = null
    reset_content()
})

afterEach(() => {
    vi.unstubAllGlobals()
})


describe('report_failure', () => {

    // Something the user did failed: they're told, and it's reported as critical
    it('tells the user what failed and reports it as critical', () => {
        const error = new Error('denied')
        report_failure(error, 'Could not rename the design')
        expect(state.toast).toBe('Could not rename the design')
        expect(report_error).toHaveBeenCalledWith('silent', error, {critical: true})
    })

    // A lost connection gets its own message, and isn't the app's fault
    it('says the connection was lost when that\'s why, and not as critical', () => {
        const error = new ApiOfflineError('/api/x', new TypeError('Failed to fetch'))
        report_failure(error, 'Could not rename the design')
        expect(state.toast).not.toBe('Could not rename the design')
        expect(state.toast).toMatch(/offline|connection|internet/i)
        expect(report_error).toHaveBeenCalledWith('silent', error, {critical: false})
    })

})


describe('the welcome splash', () => {

    // Remembered per browser once shown
    it('is remembered once it has been shown', () => {
        const storage = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key:string) => storage.get(key) ?? null,
            setItem: (key:string, value:string) => storage.set(key, value),
        })
        expect(welcome_seen()).toBe(false)
        set_welcome_seen()
        expect(welcome_seen()).toBe(true)
    })

    // Blocked storage (private mode) greets again rather than crashing
    it('copes with storage that refuses to be read or written', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('SecurityError')
            },
            setItem: () => {
                throw new Error('SecurityError')
            },
        })
        expect(welcome_seen()).toBe(false)
        expect(() => set_welcome_seen()).not.toThrow()
    })

})


describe('run_with_retry', () => {

    // The usual case: it worked, so nothing is shown
    it('succeeds without asking anything', async () => {
        expect(await run_with_retry(async () => undefined, 'Could not delete')).toBe(true)
        expect(state.alert).toBe(null)
    })

    // A failure offers "Try again", and a retry that works counts as success
    it('offers a retry after a failure, and succeeds when it then works', async () => {
        const action = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue(undefined)
        const pending = run_with_retry(action, 'Could not delete')
        expect(await answer_alert(true)).toBe('Could not delete')
        expect(await pending).toBe(true)
        expect(action).toHaveBeenCalledTimes(2)
        // A failure the user retried past isn't worth reporting
        expect(report_error).not.toHaveBeenCalled()
    })

    // Giving up reports the failure (it may be a real bug) and says it didn't happen
    it('reports the failure once the user gives up', async () => {
        const error = new Error('500')
        const pending = run_with_retry(async () => {
            throw error
        }, 'Could not delete')
        await answer_alert(false)
        expect(await pending).toBe(false)
        expect(report_error).toHaveBeenCalledWith('silent', error)
    })

    // A lost connection says so instead of the generic failure
    it('says the connection was lost when that\'s why', async () => {
        const pending = run_with_retry(async () => {
            throw new ApiOfflineError('/api/x', new TypeError('Failed to fetch'))
        }, 'Could not delete')
        expect(await answer_alert(false)).not.toBe('Could not delete')
        expect(await pending).toBe(false)
    })

    // A dead session can't be retried, only fixed by reloading to sign in again
    it('offers a reload, not a retry, when the session has expired', async () => {
        const reload = vi.fn()
        vi.stubGlobal('self', {location: {reload}})
        const error = new ApiSessionError('/api/x', new Error('auth/user-token-expired'))
        const action = vi.fn(async () => {
            throw error
        })

        // Reloading
        let pending = run_with_retry(action, 'Could not delete')
        await answer_alert(true)
        expect(await pending).toBe(false)
        expect(reload).toHaveBeenCalledOnce()
        expect(report_error).toHaveBeenCalledWith('silent', error)

        // Or just dismissing it, which leaves the page alone and never retries
        pending = run_with_retry(action, 'Could not delete')
        await answer_alert(false)
        expect(await pending).toBe(false)
        expect(reload).toHaveBeenCalledOnce()
        expect(action).toHaveBeenCalledTimes(2)
    })

})


describe('print_service_warning_dialog', () => {

    // Shown until acknowledged, with no way to cancel
    it('resolves once the warning is acknowledged', async () => {
        let done = false
        const pending = print_service_warning_dialog().then(() => {
            done = true
        })
        expect(state.print_service_warning).not.toBe(null)
        await Promise.resolve()
        expect(done).toBe(false)
        state.print_service_warning!.resolve()
        await pending
        expect(done).toBe(true)
    })

})


describe('dialogs', () => {

    // A confirm resolves with the user's answer, once they give it
    it('resolves a confirmation with the answer given', async () => {
        const pending = confirm_dialog('Delete it?')
        expect(state.confirm!.message).toBe('Delete it?')
        state.confirm!.resolve(true)
        expect(await pending).toBe(true)
    })

    // A prompt opens with its starting text and button options, and resolves with the text
    it('opens a prompt with its options and resolves with what was entered', async () => {
        const pending = prompt_dialog('Type DELETE', 'x', {confirm_label: 'Delete',
            confirm_color: 'error', require: 'DELETE'})
        expect(state.prompt).toMatchObject({message: 'Type DELETE', value: 'x',
            confirm_label: 'Delete', confirm_color: 'error', require: 'DELETE'})
        state.prompt!.resolve('DELETE')
        expect(await pending).toBe('DELETE')

        // Without options, the defaults stand
        void prompt_dialog('Name?')
        expect(state.prompt).toMatchObject({value: '', confirm_label: null, confirm_color: null,
            require: null})
    })

})


describe('page_count_guess', () => {

    // A plausible book until the first preview has measured the real thing
    it('guesses a plausible book until there is an estimate', () => {
        estimated_pages.value = null
        expect(page_count_guess()).toBe(300)
        estimated_pages.value = 42
        expect(page_count_guess()).toBe(42)
        estimated_pages.value = null
    })

})


describe('the open design\'s questions', () => {

    beforeEach(() => {
        Object.assign(blue, make_blueprint({content: [], bibles: ['eng_bsb']}))
    })

    // A copyright statement on an interior page counts, as does one in the cover's blurb
    it('finds a copyright statement on an interior page or the cover', () => {
        expect(has_copyright.value).toBe(false)
        blue.content = [custom_page(false)]
        expect(has_copyright.value).toBe(false)
        blue.content = [custom_page(true)]
        expect(has_copyright.value).toBe(true)

        // The cover's blurb (new covers carry the marker there by default)
        blue.content = []
        blue.cover = {form: {blurb: custom_page(true).doc}, bg_image: null, font_families: [],
            title_custom: false}
        expect(has_copyright.value).toBe(true)
        blue.cover = null
    })

    // Custom text takes the primary translation's direction, else left-to-right
    it('takes the design\'s direction from its primary translation', () => {
        expect(doc_dir.value).toBe('ltr')
        content.translations = {heb_wlc: {direction: 'rtl'} as never}
        blue.bibles = ['heb_wlc']
        expect(doc_dir.value).toBe('rtl')
    })

    // Study notes always need attribution, and a translation that forbids going without
    it('requires attribution for notes, and for translations that ask for it', () => {
        expect(requires_copyright.value).toBe(false)

        // Passages from a translation whose every license forbids attribution-free use
        blue.content = [{type: 'passage', id: 'p1', book: 'gen', start_chapter: 1,
            start_verse: null, end_chapter: 1, end_verse: null} as never]
        content.translations = {eng_bsb: {licenses: [
            {restrictions: {forbid_attributionless: true}}]} as never}
        expect(requires_copyright.value).toBe(true)

        // One license allowing it is enough (the stub's maps aren't reactive, so the design is
        // touched to have the computed read them again)
        content.translations = {eng_bsb: {licenses: [
            {restrictions: {forbid_attributionless: true}},
            {restrictions: {forbid_attributionless: false}}]} as never}
        blue.bibles = [...blue.bibles]
        expect(requires_copyright.value).toBe(false)

        blue.notes = 'eng_tyndale'
        expect(requires_copyright.value).toBe(true)
    })

    // Red letters are offered when any selected translation marks Jesus' words
    it('supports words of Jesus when any selected translation marks them', () => {
        blue.bibles = ['eng_a', 'eng_b']
        content.wj_markup = {eng_a: false, eng_b: false}
        expect(supports_wj.value).toBe(false)
        content.wj_markup = {eng_a: false, eng_b: true}
        // The stub's maps aren't reactive, so re-trigger through the design
        blue.bibles = ['eng_b', 'eng_a']
        expect(supports_wj.value).toBe(true)
    })

})
