
// Installing the app: it's offered only while the browser has offered to install and the user
// hasn't turned it down, each offer prompts once, and the manifest names icons that really are the sizes it claims

import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'

import {describe, it, expect, beforeEach, vi} from 'vitest'


// The app's public directory, where the manifest and its icons are served from
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')


// A fresh copy of the install service, since it keeps the browser's offer at module level
let install:typeof import('@/services/install')
beforeEach(async () => {
    vi.resetModules()
    install = await import('@/services/install')
})


// An install offer as Chromium fires it, with a prompt() that records being called and answers
// as the user would
function make_offer(outcome:'accepted'|'dismissed' = 'accepted'){
    const event = new Event('beforeinstallprompt') as Event & {prompt:ReturnType<typeof vi.fn>}
    event.prompt = vi.fn(() => Promise.resolve({outcome}))
    return event
}


describe('install offers', () => {

    it('offers nothing until the browser does', async () => {
        install.listen_for_install(new EventTarget())
        expect(install.can_install.value).toBe(false)
        // Asking anyway does nothing rather than throwing
        await install.install_app()
    })

    it('prompts once per offer', async () => {
        const target = new EventTarget()
        install.listen_for_install(target)
        const offer = make_offer()
        target.dispatchEvent(offer)
        expect(install.offer_install.value).toBe(true)

        await install.install_app()
        expect(offer.prompt).toHaveBeenCalledTimes(1)
        expect(install.can_install.value).toBe(false)
        await install.install_app()
        expect(offer.prompt).toHaveBeenCalledTimes(1)

        // A later offer (after uninstalling, say) is offered again
        target.dispatchEvent(make_offer())
        expect(install.offer_install.value).toBe(true)
    })

    it('stops offering once the user turns it down', async () => {
        const target = new EventTarget()
        install.listen_for_install(target)
        target.dispatchEvent(make_offer())
        install.dismiss_install()
        expect(install.offer_install.value).toBe(false)
        // The browser can still install it (its own menus), it's just not offered by the app
        expect(install.can_install.value).toBe(true)
    })

    it('counts cancelling the browser\'s dialog as turning it down', async () => {
        const target = new EventTarget()
        install.listen_for_install(target)
        target.dispatchEvent(make_offer('dismissed'))
        await install.install_app()
        target.dispatchEvent(make_offer())
        expect(install.can_install.value).toBe(true)
        expect(install.offer_install.value).toBe(false)
    })

    it('withdraws the offer once installed some other way', async () => {
        const target = new EventTarget()
        install.listen_for_install(target)
        const offer = make_offer()
        target.dispatchEvent(offer)
        target.dispatchEvent(new Event('appinstalled'))
        expect(install.can_install.value).toBe(false)
        await install.install_app()
        expect(offer.prompt).not.toHaveBeenCalled()
    })
})


describe('manifest', () => {

    const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, 'manifest.json'), 'utf8')) as {
        display:string, start_url:string,
        icons:{src:string, sizes:string, type:string, purpose:string}[],
    }

    it('meets the browsers\' install criteria', () => {
        // Chromium needs a standalone-ish display and 192px + 512px icons
        expect(manifest.display).toBe('standalone')
        expect(manifest.start_url).toMatch(/^\//)
        const sizes = manifest.icons.filter(icon => icon.purpose === 'any').map(i => i.sizes)
        expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    })

    it('names icons that exist at the sizes it claims', () => {
        for (const icon of manifest.icons){
            const path = join(PUBLIC_DIR, icon.src)
            expect(existsSync(path), icon.src).toBe(true)
            // A PNG's width and height are big-endian at bytes 16 and 20 of its IHDR chunk
            const png = readFileSync(path)
            expect(icon.type).toBe('image/png')
            expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
        }
    })
})
