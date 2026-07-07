#!/usr/bin/env node

// Standalone CLI for downloading fonts into an app's own fonts directory. Noto Serif/Sans +
// the full per-script fallback set are always included; --config supplies any additional
// curated fonts. Not every consumer needs to run this — the library can also be pointed at
// manifest data produced some other way (e.g. an existing hosted font collection).
//
// Usage: typst-fonts-download --fonts <dir> [--config <config.json>]
//   --fonts <dir>     Directory to download font binaries + write manifest.json into
//   --config <path>   JSON file: {noto_group?, curated?: [{family, group, style}]}

import {readFile} from 'node:fs/promises'
import {run_download} from './run.js'
import type {FontsConfig} from './types.js'

function read_arg(flag:string):string | undefined {
    const i = process.argv.indexOf(flag)
    return i === -1 ? undefined : process.argv[i + 1]
}

const fonts_dir = read_arg('--fonts') ?? './fonts'
const config_path = read_arg('--config')
const config:FontsConfig | undefined = config_path
    ? JSON.parse(await readFile(config_path, 'utf8'))
    : undefined

await run_download({fonts_dir, config})
