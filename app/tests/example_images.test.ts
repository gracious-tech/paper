
// The example designs' cover pictures are generated (.bin/gen_example_images) and committed, with
// a manifest beside them recording what each was rendered from. These keep the files, the
// manifest and the examples themselves from drifting apart — a picture missing for an example
// would leave its card blank, and one the manifest doesn't list would never be re-rendered

import {readdirSync, readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'

import {describe, it, expect} from 'vitest'

import {example_image} from '@/services/example_images'
import {EXAMPLE_DESIGNS, NOTO_STAND_INS, example_cover_overrides}
    from '@/services/example_designs'


const IMAGES_DIR = join(import.meta.dirname, '..', 'src', 'assets', 'images', 'examples')
const manifest = JSON.parse(readFileSync(join(IMAGES_DIR, 'manifest.json'), 'utf8')) as
    Record<string, Record<string, {file:boolean}>>


describe('example pictures', () => {

    it('has an English picture of every example', () => {
        for (const example of EXAMPLE_DESIGNS){
            expect(existsSync(join(IMAGES_DIR, 'en', `${example.id}.webp`)), example.id).toBe(true)
        }
    })

    it('lists exactly the pictures that exist in the manifest', () => {
        const on_disk = readdirSync(IMAGES_DIR, {withFileTypes: true})
            .filter(entry => entry.isDirectory())
            .flatMap(dir => readdirSync(join(IMAGES_DIR, dir.name))
                .map(name => `${dir.name}/${name.replace(/\.webp$/, '')}`))
        const listed = Object.entries(manifest).flatMap(([loc, entries]) =>
            Object.entries(entries).filter(([, entry]) => entry.file).map(([id]) => `${loc}/${id}`))
        expect(on_disk.sort()).toEqual(listed.sort())
    })

    it('shows a locale its own picture', () => {
        const [loc, entries] = Object.entries(manifest)
            .find(([loc, entries]) => loc !== 'en' && Object.values(entries).some(e => e.file))!
        const id = Object.keys(entries).find(id => entries[id]!.file)!
        expect(example_image(id, loc)).toContain(`/examples/${loc}/${id}.webp`)
    })

    it('says to render the pictures when an example has none at all', () => {
        expect(() => example_image('no_such_example', 'en')).toThrow(/gen_example_images/)
    })

    it("falls back to English's picture", () => {
        const id = EXAMPLE_DESIGNS[0]!.id
        expect(example_image(id, 'xx')).toContain(`/examples/en/${id}.webp`)
    })
})


describe('example cover fonts', () => {

    // Every font field each example sets, in a locale
    const fonts = (locale:string) => EXAMPLE_DESIGNS.flatMap(example =>
        Object.entries(example_cover_overrides(example, locale))
            .filter(([key]) => key.endsWith('_font'))
            .map(([, value]) => String(value)))

    it('keeps the designed fonts in English', () => {
        expect(fonts('en')).toContain('Caveat')
    })

    it('uses only Noto families in any other language', () => {
        // A decorative font added to an example without a stand-in would fail here
        for (const family of fonts('vi')){
            expect(family, family).toMatch(/^Noto (Sans|Serif)$/)
        }
        expect(Object.values(NOTO_STAND_INS).every(f => /^Noto (Sans|Serif)$/.test(f))).toBe(true)
    })
})
