// The tab's compile queue: builds take turns at the browser's compiler, so a phone never holds
// two documents' compilers (or a cover's beside a book's) at once. A turn that's never handed on
// would leave every later build "waiting for your previous build" for good, so these pin the
// hand-over itself.

import {describe, it, expect} from 'vitest'

import {claim_compile_turn, compiling_here} from '@/services/compile_progress'


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
