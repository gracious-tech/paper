
// The per-uid daily caps on the expensive routes. A speed bump rather than a wall — anyone can
// mint an anonymous account — but what it stops is the cheap case where one caller loops an
// endpoint and multiplies our cost for free.

import {describe, it, expect, beforeEach} from 'vitest'

import {quota_allows, QUOTA_COMPILE, QUOTA_COPY, QUOTA_COLLECTIONS, DAILY_COMPILE_LIMIT,
    DAILY_COPY_LIMIT} from '../../server/src/quota.ts'
import {admin_db, reset_firestore, OWNER, STRANGER} from '../helpers/server.ts'

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'


// The setup script is the only place TTL policies are enabled, and a quota collection without
// one keeps a permanent row for every uid that ever hit the route
const setup_firebase = readFileSync(
    fileURLToPath(new URL('../../.bin/setup_firebase', import.meta.url)), 'utf8')


beforeEach(async () => {
    await reset_firestore()
})


describe('quota_allows', () => {

    it('allows the first attempt', async () => {
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 3)).toBe(true)
    })

    it('allows exactly up to the limit, then refuses', async () => {
        for (let i = 0; i < 3; i++){
            expect(await quota_allows(QUOTA_COMPILE, OWNER, 3)).toBe(true)
        }
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 3)).toBe(false)
    })

    it('stays refused once over', async () => {
        for (let i = 0; i < 4; i++){
            await quota_allows(QUOTA_COMPILE, OWNER, 2)
        }
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 2)).toBe(false)
    })

    it('does not raise the count past the limit once refusing', async () => {
        // The refusing branch returns before the write, so a caller hammering a spent quota
        // does not keep generating Firestore writes
        for (let i = 0; i < 5; i++){
            await quota_allows(QUOTA_COMPILE, OWNER, 2)
        }
        const data = (await admin_db.doc(`${QUOTA_COMPILE}/${OWNER}`).get()).data()
        expect(data!['count']).toBe(2)
    })

    it('counts each user separately', async () => {
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(true)
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(false)
        expect(await quota_allows(QUOTA_COMPILE, STRANGER, 1)).toBe(true)
    })

    it('counts each action separately', async () => {
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(true)
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(false)
        expect(await quota_allows(QUOTA_COPY, OWNER, 1)).toBe(true)
    })

    it('treats a row from an earlier day as zero, resetting the window', async () => {
        await quota_allows(QUOTA_COMPILE, OWNER, 1)
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(false)
        // Rewriting the day is what a stale row looks like once midnight passes
        await admin_db.doc(`${QUOTA_COMPILE}/${OWNER}`).update({day: '2000-01-01'})
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 1)).toBe(true)
    })

    it('holds concurrent attempts from one uid to the limit', async () => {
        // The transaction is the whole point — without it two parallel callers both read the
        // same count and each write count+1, letting one past the cap
        const results = await Promise.all(
            Array.from({length: 8}, () => quota_allows(QUOTA_COMPILE, OWNER, 3)))
        expect(results.filter(Boolean)).toHaveLength(3)
    })

    it('stamps an expires timestamp so the TTL policy can collect the row', async () => {
        await quota_allows(QUOTA_COMPILE, OWNER, 1)
        const data = (await admin_db.doc(`${QUOTA_COMPILE}/${OWNER}`).get()).data()
        expect(data!['expires']).toBeDefined()
        expect((data!['expires'] as {toMillis:() => number}).toMillis())
            .toBeGreaterThan(Date.now())
    })

    it('refuses everything at a limit of zero', async () => {
        expect(await quota_allows(QUOTA_COMPILE, OWNER, 0)).toBe(false)
    })
})


describe('quota collection registry', () => {

    // A new quota collection leaks unless three things line up: an entry in QUOTA_COLLECTIONS so
    // account deletion sweeps it, a TTL line in setup_firebase so rows expire, and a
    // quota_allows() call on the route itself

    it('lists every collection the module defines', () => {
        expect(QUOTA_COLLECTIONS).toContain(QUOTA_COMPILE)
        expect(QUOTA_COLLECTIONS).toContain(QUOTA_COPY)
    })

    it('has a TTL policy line in setup_firebase for each', () => {
        for (const collection of QUOTA_COLLECTIONS){
            expect(setup_firebase).toContain(`--collection-group=${collection} --enable-ttl`)
        }
    })

    it('matches no Firestore security rule, so a client cannot reset its own count', () => {
        // Asserted from the client side in tests/rules/firestore.test.ts; here it is only that
        // the collection names the rules file deliberately omits are still these ones
        const rules = readFileSync(
            fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8')
        for (const collection of QUOTA_COLLECTIONS){
            expect(rules).not.toContain(`match /${collection}/`)
        }
    })
})


describe('configured limits', () => {

    it('caps server compiles well below anything a person reaches by hand', () => {
        expect(DAILY_COMPILE_LIMIT).toBeGreaterThan(0)
        expect(DAILY_COMPILE_LIMIT).toBeLessThanOrEqual(200)
    })

    it('keeps the copy cap generous but finite', () => {
        // Sized to be unreachable by clicking while still cutting off an unattended loop
        expect(DAILY_COPY_LIMIT).toBeGreaterThan(DAILY_COMPILE_LIMIT)
        expect(Number.isFinite(DAILY_COPY_LIMIT)).toBe(true)
    })
})
