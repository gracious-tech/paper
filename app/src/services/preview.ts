
// A design's preview: a window of its pages, each a standalone SVG, plus its cover's panels where
// the window reaches them. A phone shows them one under another, full screen, before building
// (see DialogPhonePreview.vue); a desktop shows them as facing-page spreads beside the editor,
// all along (see DisplayPreview.vue). Either is made in this browser, or on the server for a
// device that compiles there or whose browser fails at it (see compile_mode.ts), and comes out
// the same either way.

import {PREVIEW_LIMITS, svg_page_markup} from 'paper-bible-typst'

import {blue} from '@/services/state'
import {typst_generator} from '@/services/typst'
import {render_cover_panels} from '@/services/cover'
import {compile_preview_window, render_signature, set_page_estimate}
    from '@/services/page_estimate'
import {claim_compile_turn} from '@/services/compile_progress'
import {PREVIEW_TIMEOUT_MS, DESKTOP_PREVIEW_TIMEOUT_MS, DESKTOP_PREVIEW_CAP_MS, SlowCompileError,
    BrowserMemoryError, switch_to_server, compiles_on_server, is_device_failure, strike,
    clear_strikes, recheck_due, recheck_passed, recheck_failed} from '@/services/compile_mode'
import {request_server_preview} from '@/services/server_preview'
import {report_error} from '@/services/errors'

import type {PreviewPages, PreviewSection, PreviewSize} from 'paper-bible-typst'
import type {TypstWorkerClient} from '@/services/typst'
import type {CompileProgress} from '@/services/compile_progress'


// A preview ready to show
export interface Preview extends PreviewPages {
    // Whether the document was cut to a window, and on which sides content was left out
    truncated:boolean
    dropped_before:boolean
    dropped_after:boolean
}


// Progress readouts, as the views show them
type OnProgress = (event:CompileProgress) => void


export async function browser_preview(generator:TypstWorkerClient, size:PreviewSize,
        section:PreviewSection, on_progress?:OnProgress,
        options:{timeout_ms?:number, on_compile?:() => void} = {}):Promise<Preview>{
    // The open design's preview, compiled in this browser. A phone waits for any build compiling
    // here first, since it can't hold two documents' compilers (see claim_compile_turn)
    const release_turn = size === 'phone' ? await claim_compile_turn() : () => {}
    try {
        on_progress?.({stage: 'start'})
        const window = await compile_preview_window(generator, section, PREVIEW_LIMITS[size],
            on_progress, options)
        const {truncation, page_estimate} = window
        if (render_signature() === window.signature){
            set_page_estimate(page_estimate, window.signature)
        }

        // The cover's panels where the window reaches them, its spine sized from the estimate.
        // A phone frees the book's compiler first, as it may not hold the cover's beside it
        const show_front = !!blue.cover && !truncation.dropped_before
        const show_back = !!blue.cover && !truncation.dropped_after
        let panels:{front:string, back:string}|null = null
        if (show_front || show_back){
            on_progress?.({stage: 'cover'})
            if (size === 'phone'){
                generator.release_memory()
            }
            panels = await render_cover_panels(blue, page_estimate, window.share_url)
        }
        return {
            pages: window.pages.map(page => svg_page_markup(page)),
            front_cover: show_front ? panels!.front : null,
            back_cover: show_back ? panels!.back : null,
            truncated: truncation.truncated,
            dropped_before: truncation.dropped_before,
            dropped_after: truncation.dropped_after,
        }
    } finally {
        release_turn()
    }
}


export async function phone_preview(on_progress:OnProgress, on_slow:() => void)
        :Promise<Preview>{
    // A phone's preview, from this browser or the server. Any failure here has the server make
    // it instead, and one that was the phone's own switches it to the server for good (it can
    // lose the user's tab, see compile_mode.ts). `on_slow` is told when that was for being slow
    const generator = typst_generator.value
    if (compiles_on_server() || !generator){
        return await request_server_preview('phone', 'start', on_progress)
    }
    try {
        return await browser_preview(generator, 'phone', 'start', on_progress,
            {timeout_ms: PREVIEW_TIMEOUT_MS})
    } catch (error){
        report_error('silent', error, {context: {stage: 'phone_preview'}})
        if (is_device_failure(error)){
            switch_to_server(error instanceof SlowCompileError ? 'slow' : 'memory')
        }
        if (error instanceof SlowCompileError){
            on_slow()
        }
        return await request_server_preview('phone', 'start', on_progress)
    }
}


export async function desktop_preview(section:PreviewSection, on_progress:OnProgress,
        is_current:() => boolean = () => true):Promise<Preview>{
    // A desktop's preview of the given window. In its browser, unless that takes longer than
    // DESKTOP_PREVIEW_TIMEOUT_MS, when the server races it and whichever finishes first is shown
    // (the server winning is a strike towards switching, see strike). A desktop in server mode
    // has the server make it, and every so often its own browser too (see recheck_due).
    // `is_current` says whether the preview is still wanted, since the user may have edited the
    // design since: a superseded one never asks the server for anything
    const generator = typst_generator.value
    if (compiles_on_server() || !generator){
        if (generator && recheck_due()){
            return await recheck(generator, section, on_progress)
        }
        return await request_server_preview('desktop', section, on_progress)
    }

    // Started in the browser, timed from when its compile begins (not the Bible's download)
    let compiling:() => void = () => {}
    const compile_started = new Promise<void>(resolve => {
        compiling = resolve
    })
    const browser = browser_preview(generator, 'desktop', section, on_progress,
        {timeout_ms: DESKTOP_PREVIEW_CAP_MS, on_compile: compiling})
    const too_slow = compile_started.then(() => new Promise<'too_slow'>(resolve => {
        setTimeout(() => resolve('too_slow'), DESKTOP_PREVIEW_TIMEOUT_MS)
    }))
    const early = await Promise.race([browser.then(preview => ({preview}),
        (error:unknown) => ({error})), too_slow])

    // Done in time: whatever went wrong before was a blip
    if (early !== 'too_slow' && 'preview' in early){
        clear_strikes()
        return early.preview
    }

    // Failed: the server makes this one instead, and running out of memory switches the device
    if (early !== 'too_slow'){
        report_error('silent', early.error, {context: {stage: 'preview'}})
        if (early.error instanceof BrowserMemoryError){
            switch_to_server('memory')
        }
        if (!is_current()){
            throw early.error
        }
        return await request_server_preview('desktop', section, on_progress)
    }

    // Superseded while it ran: nothing to race for
    if (!is_current()){
        return await browser
    }

    // Too slow so far: the server races it, and the loser's result is dropped. Only the server
    // winning counts against the browser: one that finishes first, however late, is still the
    // quickest way this device has of previewing
    const server = request_server_preview('desktop', section, on_progress)
    void browser.catch((error:unknown) => {
        if (error instanceof BrowserMemoryError){
            switch_to_server('memory')
        }
    })
    const winner = await first_of(
        browser.then(preview => ({preview, from: 'browser' as const})),
        server.then(preview => ({preview, from: 'server' as const})))
    if (winner.from === 'server'){
        generator.abandon()
        strike('slow')
    }
    return winner.preview
}


async function first_of<T>(browser:Promise<T>, server:Promise<T>):Promise<T>{
    // The first of a browser and a server preview to succeed, or the server's failure when
    // neither does (the one the user is told about, and already reported by the server)
    void browser.catch(() => undefined)
    void server.catch(() => undefined)
    try {
        return await Promise.any([browser, server])
    } catch {
        return await server
    }
}


async function recheck(generator:TypstWorkerClient, section:PreviewSection,
        on_progress:OnProgress):Promise<Preview>{
    // A desktop in server mode trying its own browser again, beside the server's preview: if it
    // finishes in DESKTOP_PREVIEW_TIMEOUT_MS the device compiles there again. The user sees
    // whichever is first, and the server's progress meanwhile
    const server = request_server_preview('desktop', section, on_progress)
    const browser = browser_preview(generator, 'desktop', section, undefined,
        {timeout_ms: DESKTOP_PREVIEW_TIMEOUT_MS})
    browser.then(() => recheck_passed(), () => recheck_failed())
    return await first_of(browser, server)
}
