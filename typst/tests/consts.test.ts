
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {describe, it, expect} from 'vitest'

import {SCHEMA_VERSION, PDF_LIFETIME_MS, COMPILE_STATS_LIFETIME_MS, QUOTA_LIFETIME_MS}
    from '../src/consts.js'


// These constants are only half of each contract — the other half lives in a deploy config that
// nothing imports, so drift between them is invisible until data goes missing in production


const DAY_MS = 24 * 60 * 60 * 1000


// The bucket lifecycle rules, as applied by .bin/setup_firebase
const lifecycle = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../firebase_storage_lifecycle.json', import.meta.url)),
    'utf8')) as {rule:{action:{type:string},
        condition:{age:number, matchesPrefix?:string[], matchesSuffix?:string[]}}[]}


// The one-time GCP setup script, which is where Firestore TTL policies are enabled
const setup_firebase = readFileSync(
    fileURLToPath(new URL('../../.bin/setup_firebase', import.meta.url)), 'utf8')


describe('PDF_LIFETIME_MS', () => {

    it('matches the bucket rule that actually deletes version PDFs', () => {
        // The app writes pdf_expires from this constant; the bucket deletes on its own schedule.
        // A mismatch means the app either offers a download of an object already swept, or hides
        // one that is still there
        const rule = lifecycle.rule.find(
            r => r.condition.matchesPrefix?.includes('versions/'))
        expect(rule).toBeDefined()
        expect(rule!.action.type).toBe('Delete')
        expect(rule!.condition.matchesSuffix).toEqual(['.pdf'])
        expect(PDF_LIFETIME_MS).toBe(rule!.condition.age * DAY_MS)
    })
})


describe('Firestore TTL policies', () => {

    // A collection carrying an `expires` field but no policy keeps every row forever

    it('enables a policy for compile_stats', () => {
        expect(setup_firebase).toContain('--collection-group=compile_stats --enable-ttl')
        expect(COMPILE_STATS_LIFETIME_MS).toBeGreaterThan(0)
    })

    it('enables a policy for every quota collection', () => {
        // The collection names themselves are asserted against QUOTA_COLLECTIONS in the server
        // suite; here it is only that each has a line at all
        for (const collection of ['compile_quota', 'copy_quota']){
            expect(setup_firebase).toContain(`--collection-group=${collection} --enable-ttl`)
        }
    })

    it('keeps a quota row past the day it counts, for clock skew', () => {
        expect(QUOTA_LIFETIME_MS).toBeGreaterThan(DAY_MS)
    })
})


describe('SCHEMA_VERSION', () => {

    it('is a positive integer', () => {
        expect(Number.isInteger(SCHEMA_VERSION)).toBe(true)
        expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
    })
})
