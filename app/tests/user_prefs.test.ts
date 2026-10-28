// Account-wide preferences (user_prefs.ts), on the user's own root doc so they outlive any
// design: whether the print-service warning has been seen, read on demand and recorded with a
// merge so nothing else on the doc is touched

import {describe, it, expect, beforeEach, vi} from 'vitest'


// Firestore: one doc per path, and every write made
const fs = vi.hoisted(() => ({
    docs: new Map<string, Record<string, unknown>>(),
    set_doc: vi.fn(async (..._args:unknown[]) => undefined),
}))
vi.mock('firebase/firestore', () => ({
    doc: (_db:unknown, ...segments:string[]) => segments.join('/'),
    getDoc: async (path:string) => ({data: () => fs.docs.get(path)}),
    setDoc: fs.set_doc,
}))
vi.mock('@/services/firebase', () => ({firestore: {}}))
vi.mock('@/services/auth', () => ({user: {value: {uid: 'u1'}}}))


import {has_seen_print_service_warning, record_seen_print_service_warning}
    from '@/services/user_prefs'


beforeEach(() => {
    fs.docs.clear()
    fs.set_doc.mockClear()
})


describe('the print-service warning', () => {

    // An account with no root doc yet, or one without the flag, hasn't seen it
    it('reads as unseen until recorded', async () => {
        expect(await has_seen_print_service_warning()).toBe(false)
        fs.docs.set('users/u1', {other: true})
        expect(await has_seen_print_service_warning()).toBe(false)
        fs.docs.set('users/u1', {seen_print_service_warning: true})
        expect(await has_seen_print_service_warning()).toBe(true)
    })

    // Recorded by merging, so the rest of the user's doc survives
    it('records it seen without touching the rest of the doc', async () => {
        await record_seen_print_service_warning()
        expect(fs.set_doc).toHaveBeenCalledWith('users/u1', {seen_print_service_warning: true},
            {merge: true})
    })
})
