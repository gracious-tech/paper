
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, it, expect} from 'vitest'


// The build only lowers syntax (target es2018 in vite.config.mts), never regex syntax, which a
// browser parses with the rest of its chunk. A pattern an older browser can't parse is a
// SyntaxError for the whole chunk, so the app never gets past its loading screen there


// The source trees that end up in the browser bundle
const ROOTS = ['../src', '../../typst/src', '../../typst-web/src']
    .map(dir => fileURLToPath(new URL(dir, import.meta.url)))


// Every .ts/.vue file under a directory
function list_sources(dir:string):string[] {
    return readdirSync(dir, {withFileTypes: true, recursive: true})
        .filter(entry => entry.isFile() && /\.(ts|vue)$/.test(entry.name))
        .map(entry => join(entry.parentPath, entry.name))
}


describe('browser support', () => {

    it('uses no regex lookbehind, which Safari only parses from 16.4', () => {
        // Older iPhones (the 6s and 7 stop at iOS 15) can't update past it. Comment lines are
        // skipped so the reason can still be written down beside the code that avoids one
        const found:string[] = []
        for (const file of ROOTS.flatMap(list_sources)) {
            readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
                if (!line.trim().startsWith('//') && /\(\?<[=!]/.test(line)) {
                    found.push(`${file}:${index + 1}`)
                }
            })
        }
        expect(found).toEqual([])
    })
})
