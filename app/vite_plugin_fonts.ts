
// A vite plugin that serves this app's downloaded fonts (see .bin/download_fonts) under
// /generator_assets/fonts/ during development, mirroring how they're expected to be published
// alongside the built app in production

import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import path from 'node:path'

import type {Plugin} from 'vite'


const URL_PREFIX = '/generator_assets/fonts/'

const MIME_TYPES:Record<string, string> = {
    '.json': 'application/json',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}


export default function(fonts_dir:string):Plugin{
    // Return config for plugin

    return {
        name: 'serve-fonts',

        configureServer(server){
            server.middlewares.use((req, res, next) => {
                // Only handle requests under the fonts URL prefix, pass everything else along
                if (!req.url?.startsWith(URL_PREFIX)){
                    next()
                    return
                }

                // Resolve the requested file, rejecting any attempt to escape fonts_dir
                const rel = decodeURIComponent(req.url.slice(URL_PREFIX.length).split('?')[0] ?? '')
                const file_path = path.join(fonts_dir, rel)
                if (!file_path.startsWith(fonts_dir)){
                    res.statusCode = 403
                    res.end()
                    return
                }

                void stat(file_path).then(() => {
                    res.setHeader('Content-Type',
                        MIME_TYPES[path.extname(file_path)] ?? 'application/octet-stream')
                    createReadStream(file_path).pipe(res)
                }).catch(() => {
                    next()
                })
            })
        },

    }
}
