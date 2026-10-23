
// The compile function's cold-start asset sync (server/src/lambda_bootstrap.ts): what it copies
// from the assets bucket into ASSETS_DIR, and that a warm environment syncs once while a failed
// sync is retried rather than poisoning the environment for its lifetime. Every server compile
// in production starts here, and nothing else runs it before deploy.
//
// S3 is an in-memory bucket (the client is replaced below). Each test imports the module fresh,
// since its memo is module-level state

import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'


// The bucket's objects by key, how many keys a listing returns per page, and every command sent
const s3 = vi.hoisted(() => ({
    objects: new Map<string, string>(),
    page_size: 2,
    commands: [] as {type:string, input:Record<string, unknown>}[],
    // A key whose download fails, to stand in for a transient S3 error
    failing: null as string|null,
}))

vi.mock('@aws-sdk/client-s3', () => {
    // Commands just carry their input, as the real ones do
    class ListObjectsV2Command {
        input:Record<string, unknown>
        constructor(input:Record<string, unknown>){
            this.input = input
        }
    }
    class GetObjectCommand {
        input:Record<string, unknown>
        constructor(input:Record<string, unknown>){
            this.input = input
        }
    }
    class S3Client {
        async send(command:ListObjectsV2Command|GetObjectCommand){
            const input = command.input
            s3.commands.push({type: command.constructor.name, input})
            if (command instanceof ListObjectsV2Command){
                // Paged like the real API: a continuation token is the next key's index
                const keys = [...s3.objects.keys()].sort()
                    .filter(key => key.startsWith(input['Prefix'] as string))
                const start = Number(input['ContinuationToken'] ?? 0)
                const page = keys.slice(start, start + s3.page_size)
                const more = start + s3.page_size < keys.length
                return {Contents: page.map(Key => ({Key})),
                    NextContinuationToken: more ? String(start + s3.page_size) : undefined}
            }
            const key = input['Key'] as string
            if (key === s3.failing){
                throw new Error('SlowDown')
            }
            const body = s3.objects.get(key)!
            return {Body: {transformToByteArray: async () => new TextEncoder().encode(body)}}
        }
    }
    return {S3Client, ListObjectsV2Command, GetObjectCommand}
})


let assets_dir:string

// A fresh copy of the module (and of the config it reads ASSETS_DIR from)
async function load(){
    vi.resetModules()
    process.env['ASSETS_DIR'] = assets_dir
    return await import('../../server/src/lambda_bootstrap.ts')
}

// What the sync wrote under ASSETS_DIR for a key, or null
async function synced(key:string):Promise<string|null>{
    const file = path.join(assets_dir, key)
    return existsSync(file) ? await readFile(file, 'utf8') : null
}

// How many syncs started: each lists both prefixes from their first page once
function syncs():number{
    return s3.commands.filter(command => command.type === 'ListObjectsV2Command'
        && command.input['ContinuationToken'] === undefined).length / 2
}


beforeEach(async () => {
    assets_dir = await mkdtemp(path.join(tmpdir(), 'assets_sync_'))
    s3.objects = new Map([
        ['fonts/Merriweather/regular.ttf', 'merriweather'],
        ['fonts/Merriweather/bold.ttf', 'merriweather bold'],
        ['fonts/noto/NotoSansArabic.ttf', 'noto arabic'],
        ['backgrounds/sunrise.jpg', 'sunrise'],
        ['backgrounds/previews_2700/sunrise.jpg', 'preview'],
        ['backgrounds/thumbnails/sunrise.jpg', 'thumbnail'],
        ['docs/widget.html', 'not the compile\'s'],
    ])
    s3.commands = []
    s3.failing = null
})

afterEach(async () => {
    delete process.env['ASSETS_DIR']
    delete process.env['ASSETS_BUCKET']
    await rm(assets_dir, {recursive: true, force: true})
})


describe('ensure_assets_synced', () => {

    it('copies all of fonts/ and only the top level of backgrounds/', async () => {
        const {ensure_assets_synced} = await load()
        await ensure_assets_synced()

        // Fonts whole (Typst enumerates the tree), at the paths they had in the bucket
        expect(await synced('fonts/Merriweather/regular.ttf')).toBe('merriweather')
        expect(await synced('fonts/Merriweather/bold.ttf')).toBe('merriweather bold')
        expect(await synced('fonts/noto/NotoSansArabic.ttf')).toBe('noto arabic')
        // The original backgrounds the cover render reads by id, but not the widget's previews
        expect(await synced('backgrounds/sunrise.jpg')).toBe('sunrise')
        expect(await synced('backgrounds/previews_2700/sunrise.jpg')).toBe(null)
        expect(await synced('backgrounds/thumbnails/sunrise.jpg')).toBe(null)
        // Nor anything outside the two prefixes
        expect(await synced('docs/widget.html')).toBe(null)
    })

    it('pages through a listing longer than one response', async () => {
        // Three fonts at two keys a page: the listing has to follow its continuation token
        const {ensure_assets_synced} = await load()
        await ensure_assets_synced()

        const font_listings = s3.commands.filter(command =>
            command.type === 'ListObjectsV2Command' && command.input['Prefix'] === 'fonts/')
        expect(font_listings.map(command => command.input['ContinuationToken']))
            .toEqual([undefined, '2'])
        expect(await synced('fonts/noto/NotoSansArabic.ttf')).toBe('noto arabic')
    })

    it('syncs once per environment, however many compiles ask', async () => {
        const {ensure_assets_synced} = await load()
        // Two compiles arriving together share the one sync, and a later one finds it done
        await Promise.all([ensure_assets_synced(), ensure_assets_synced()])
        await ensure_assets_synced()
        expect(syncs()).toBe(1)
    })

    it('a failed sync is retried by the next compile, not remembered', async () => {
        const {ensure_assets_synced} = await load()
        s3.failing = 'backgrounds/sunrise.jpg'
        await expect(ensure_assets_synced()).rejects.toThrow('SlowDown')

        // The next invocation in this warm environment starts over, and succeeds
        s3.failing = null
        await ensure_assets_synced()
        expect(syncs()).toBe(2)
        expect(await synced('backgrounds/sunrise.jpg')).toBe('sunrise')
    })

    it('reads from the bucket the stack names', async () => {
        process.env['ASSETS_BUCKET'] = 'stack-assets-bucket'
        const {ensure_assets_synced} = await load()
        await ensure_assets_synced()
        expect(new Set(s3.commands.map(command => command.input['Bucket'])))
            .toEqual(new Set(['stack-assets-bucket']))
    })
})
