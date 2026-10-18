
// The per-uid daily caps on the expensive routes. A speed bump rather than a wall — anyone can
// mint an anonymous account — but what it stops is the cheap case where one caller loops an
// endpoint and multiplies our cost for free.

import {describe, it, expect, beforeEach} from 'vitest'

import {quota_allows, claim_compile_lock, extend_compile_lock, release_compile_lock,
    QUOTA_COMPILE, QUOTA_COPY, COMPILE_LOCK, QUOTA_COLLECTIONS, COMPILE_LOCK_MS,
    DAILY_COMPILE_LIMIT, DAILY_COPY_LIMIT} from '../../server/src/quota.ts'
import {admin_db, reset_firestore, at_later_time, OWNER, STRANGER} from '../helpers/server.ts'

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'


// The setup script is the only place TTL policies are enabled, and a quota collection without
// one keeps a permanent row for every uid that ever hit the route
const deploy_firebase_initial = readFileSync(
    fileURLToPath(new URL('../../.bin/deploy_firebase_initial', import.meta.url)), 'utf8')


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


describe('compile lock', () => {

    // One server compile at a time per user. It lives in Firestore because the route that claims
    // it and the compile that releases it run in different Lambda functions

    it('is claimed when free', async () => {
        expect(await claim_compile_lock(OWNER, 'v1')).toBe('claimed')
    })

    it('refuses another version while held', async () => {
        await claim_compile_lock(OWNER, 'v1')
        expect(await claim_compile_lock(OWNER, 'v2')).toBe('other_version')
    })

    it('reports the same version as already compiling, rather than claiming it twice', async () => {
        await claim_compile_lock(OWNER, 'v1')
        expect(await claim_compile_lock(OWNER, 'v1')).toBe('same_version')
    })

    it('is held per user', async () => {
        await claim_compile_lock(OWNER, 'v1')
        expect(await claim_compile_lock(STRANGER, 'v2')).toBe('claimed')
    })

    it('is free again once released', async () => {
        await claim_compile_lock(OWNER, 'v1')
        await release_compile_lock(OWNER, 'v1')
        expect(await claim_compile_lock(OWNER, 'v2')).toBe('claimed')
    })

    it('lapses on its own, so a compile that died cannot block the user forever', async () => {
        await claim_compile_lock(OWNER, 'v1')
        const claim = await at_later_time(COMPILE_LOCK_MS + 1000,
            () => claim_compile_lock(OWNER, 'v2'))
        expect(claim).toBe('claimed')
    })

    it('is not released by a compile whose claim lapsed and passed on', async () => {
        await claim_compile_lock(OWNER, 'v1')
        await at_later_time(COMPILE_LOCK_MS + 1000, () => claim_compile_lock(OWNER, 'v2'))
        await release_compile_lock(OWNER, 'v1')
        expect(await claim_compile_lock(OWNER, 'v3')).toBe('other_version')
    })

    it('restarts its lifetime when extended by the compile holding it', async () => {
        // A compile can wait in Lambda's async queue before it starts
        await claim_compile_lock(OWNER, 'v1')
        await at_later_time(COMPILE_LOCK_MS - 1000, () => extend_compile_lock(OWNER, 'v1'))
        const claim = await at_later_time(COMPILE_LOCK_MS + 1000,
            () => claim_compile_lock(OWNER, 'v2'))
        expect(claim).toBe('other_version')
    })

    it('holds concurrent claims to one winner', async () => {
        const results = await Promise.all(
            ['v1', 'v2', 'v3', 'v4'].map(version_id => claim_compile_lock(OWNER, version_id)))
        expect(results.filter(result => result === 'claimed')).toHaveLength(1)
    })
})


describe('quota collection registry', () => {

    // A new quota collection leaks unless three things line up: an entry in QUOTA_COLLECTIONS so
    // account deletion sweeps it, a TTL line in deploy_firebase_initial so rows expire, and a
    // quota_allows() call on the route itself

    it('lists every collection the module defines', () => {
        expect(QUOTA_COLLECTIONS).toContain(QUOTA_COMPILE)
        expect(QUOTA_COLLECTIONS).toContain(QUOTA_COPY)
        expect(QUOTA_COLLECTIONS).toContain(COMPILE_LOCK)
    })

    it('has a TTL policy line in deploy_firebase_initial for each', () => {
        for (const collection of QUOTA_COLLECTIONS){
            expect(deploy_firebase_initial).toContain(
                `--collection-group=${collection} --enable-ttl`)
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
