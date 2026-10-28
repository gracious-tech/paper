// The tab's compile queue: builds take turns at the browser's compiler, so a phone never holds
// two documents' compilers (or a cover's beside a book's) at once. A turn that's never handed on
// would leave every later build "waiting for your previous build" for good, so these pin the
// hand-over itself.

import {describe, it, expect, vi, afterEach} from 'vitest'

import {claim_compile_turn, compiling_here, generating_here, hold_page, stage_text}
    from '@/services/compile_progress'
import {translate} from '@/services/i18n'

import type {CompileProgress} from '@/services/compile_progress'


// Let every already-settled promise callback run
async function flush():Promise<void>{
    for (let i = 0; i < 10; i++){
        await Promise.resolve()
    }
}


describe('claim_compile_turn', () => {

    it('grants turns one at a time, in the order claimed', async () => {
        const order:string[] = []
        const first = claim_compile_turn().then(release => {
            order.push('first')
            return release
        })
        const second = claim_compile_turn().then(release => {
            order.push('second')
            return release
        })
        const release_first = await first
        await flush()
        expect(order).toEqual(['first'])

        release_first()
        const release_second = await second
        expect(order).toEqual(['first', 'second'])
        release_second()
    })

    it('tracks whether any turn is held or waiting', async () => {
        expect(compiling_here.value).toBe(false)
        const release = await claim_compile_turn()
        const waiting = claim_compile_turn()
        expect(compiling_here.value).toBe(true)
        release()
        expect(compiling_here.value).toBe(true)
        ;(await waiting)()
        expect(compiling_here.value).toBe(false)
    })

    it('ignores a second release rather than freeing a later turn early', async () => {
        const release_first = await claim_compile_turn()
        let second_started = false
        const second = claim_compile_turn().then(release => {
            second_started = true
            return release
        })
        release_first()
        const release_second = await second
        expect(second_started).toBe(true)

        let third_started = false
        const third = claim_compile_turn().then(release => {
            third_started = true
            return release
        })
        release_first()
        await flush()
        expect(third_started).toBe(false)
        release_second()
        ;(await third)()
        expect(compiling_here.value).toBe(false)
    })
})


describe('hold_page', () => {

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // Leaving mid-generation is confirmed by the browser, and only while something is held
    // (a beforeunload listener can keep a page out of the back/forward cache)
    it('asks the browser to confirm leaving only while a generation is held', () => {
        const listeners = new Map<string, EventListener>()
        vi.stubGlobal('addEventListener', (type:string, listener:EventListener) => {
            listeners.set(type, listener)
        })
        vi.stubGlobal('removeEventListener', (type:string) => {
            listeners.delete(type)
        })
        const release_first = hold_page()
        const release_second = hold_page()
        expect(generating_here.value).toBe(true)

        const event = {preventDefault: vi.fn(), returnValue: false}
        listeners.get('beforeunload')!(event as unknown as Event)
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.returnValue).toBe(true)

        release_first()
        release_first()
        expect(listeners.has('beforeunload')).toBe(true)
        release_second()
        expect(listeners.has('beforeunload')).toBe(false)
        expect(generating_here.value).toBe(false)
    })
})


describe('stage_text', () => {

    // What each stage tells someone watching, in their language
    const text = (event:CompileProgress) => stage_text(event, translate)

    it('names each stage a user would care about', () => {
        expect(text({stage: 'cover'})).toBe('Preparing cover…')
        expect(text({stage: 'offline'})).toBe('Waiting for an internet connection…')
        expect(text({stage: 'queued'})).toBe('Waiting for your previous build to finish…')
        expect(text({stage: 'server'})).toBe('Making the preview on our servers…')
        expect(text({stage: 'start'})).toBe('Getting started…')
        expect(text({stage: 'finalize'})).toBe('Final touches…')
    })

    // Downloading and writing carry the passage and how far along it is
    it('counts through the passages being downloaded and written', () => {
        expect(text({stage: 'fetch', label: 'Genesis', i: 1, total: 3}))
            .toBe('Downloading Genesis (1/3)')
        expect(text({stage: 'compile', label: 'Exodus', i: 2, total: 3}))
            .toContain('Exodus')
        expect(text({stage: 'fetch'} as CompileProgress)).toBe('Downloading  (0/0)')
    })

    // Anything else keeps whatever was showing rather than flashing an unrelated message
    it('says nothing for the stages a user wouldn\'t follow', () => {
        expect(text({stage: 'arrange'} as CompileProgress)).toBe(null)
    })
})
