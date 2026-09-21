
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'

import {S3Client, ListObjectsV2Command, GetObjectCommand} from '@aws-sdk/client-s3'

import {config} from './config.ts'

import type {_Object} from '@aws-sdk/client-s3'


// Populates ASSETS_DIR (/tmp/assets in Lambda) from the bookcover repo's assets bucket, since
// Lambda has no equivalent of Cloud Run's GCS-FUSE bucket-as-filesystem mount. Only the two
// prefixes compile.ts/typst-node actually read are synced (fonts/ for Typst's --font-path
// directory enumeration, backgrounds/ for built-in cover backgrounds) — not the whole bucket
// (docs/frames/typst/ are for the bookcover widget and browser compile, irrelevant here).
//
// Must be triggered lazily on first invocation (see lambda.ts), never at module load: Lambda's
// INIT phase has a fixed ~10s timeout that isn't extendable by the function's own configured
// timeout, and this sync can plausibly take longer than that on a cold start. Memoized in a
// module-level promise so every invocation after the first in a given execution environment is
// a no-op — the same "warm instance keeps its cache" pattern content.ts already relies on for
// Bible book data
const ASSETS_BUCKET = process.env['ASSETS_BUCKET'] ?? 'paper-cover-assets-073034502699'
const ASSETS_REGION = process.env['AWS_REGION'] ?? 'us-west-2'
const SYNC_PREFIXES = ['fonts/', 'backgrounds/']
// How many objects to download at once — bounded so a cold start doesn't open hundreds of
// concurrent S3 connections, but still well parallel enough to matter
const DOWNLOAD_CONCURRENCY = 16

let sync_promise:Promise<void>|null = null


async function download_object(client:S3Client, key:string):Promise<void>{
    // Fetch one object and write it under ASSETS_DIR, preserving its relative path
    const dest = path.join(config.assets_dir, key)
    await mkdir(path.dirname(dest), {recursive: true})
    const response = await client.send(new GetObjectCommand({Bucket: ASSETS_BUCKET, Key: key}))
    const bytes = await response.Body?.transformToByteArray()
    if (bytes){
        await writeFile(dest, bytes)
    }
}


async function list_prefix(client:S3Client, prefix:string):Promise<_Object[]>{
    // Page through every object under one prefix
    const objects:_Object[] = []
    let continuation_token:string|undefined
    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: ASSETS_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuation_token,
        }))
        objects.push(...(response.Contents ?? []))
        continuation_token = response.NextContinuationToken
    } while (continuation_token)
    return objects
}


async function run_sync():Promise<void>{
    const client = new S3Client({region: ASSETS_REGION})
    const lists = await Promise.all(SYNC_PREFIXES.map(prefix => list_prefix(client, prefix)))
    const keys = lists.flat().map(object => object.Key).filter((key):key is string => !!key)

    // A small fixed-size worker pool rather than Promise.all on everything at once
    let next = 0
    async function worker():Promise<void>{
        while (next < keys.length){
            const key = keys[next++]!
            await download_object(client, key)
        }
    }
    await Promise.all(Array.from({length: DOWNLOAD_CONCURRENCY}, worker))
}


export function ensure_assets_synced():Promise<void>{
    // Kick off (or await an in-flight) sync — safe to call on every compile request. On failure,
    // clear the memo so the *next* invocation retries from scratch instead of this warm
    // environment being permanently stuck failing on a transient S3 hiccup for its whole
    // lifetime — the request that hit the failure still sees it (the throw below), only later
    // ones get a fresh attempt
    sync_promise ??= run_sync().catch(error => {
        sync_promise = null
        throw error
    })
    return sync_promise
}
