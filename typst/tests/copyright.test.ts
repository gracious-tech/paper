
import {describe, it, expect} from 'vitest'

import {gen_copyright_typst} from '../src/copyright.js'

import {make_blueprint} from './fixtures.js'

import type {GetResourcesItem, RuntimeLicense} from '@gracious.tech/fetch-client'


type Restrictions = RuntimeLicense['restrictions']


// No restrictions at all — a public-domain translation
const FREE:Restrictions = {
    forbid_attributionless: false,
    forbid_commercial: false,
    forbid_derivatives: false,
    forbid_limitless: false,
    forbid_other: false,
}


// Build the resource metadata the copyright builder reads, with only the fields it touches
function make_resource(id:string, overrides:{restrictions?:Partial<Restrictions>,
        license_id?:string|null, license_name?:string, license_url?:string,
        name_local?:string, name_english?:string, attribution?:string} = {}):GetResourcesItem {
    return {
        id,
        name_local: overrides.name_local ?? 'Berean Standard Bible',
        name_english: overrides.name_english ?? 'Berean Standard Bible',
        attribution: overrides.attribution ?? 'BSB Committee',
        licenses: [{
            id: overrides.license_id === undefined ? 'cc0' : overrides.license_id,
            name: overrides.license_name ?? 'CC0',
            url: overrides.license_url ?? 'https://example.org/license',
            restrictions: {...FREE, ...overrides.restrictions},
        }],
    } as unknown as GetResourcesItem
}


const RESOURCES = {eng_bsb: make_resource('eng_bsb')}


describe('blanket statement', () => {

    it('allows modification when nothing forbids it', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES)
        expect(out).toContain('freely copied, modified, and translated')
    })

    it('downgrades to share-only when a translation forbids derivatives outright', () => {
        const resources = {eng_bsb: make_resource('eng_bsb',
            {restrictions: {forbid_derivatives: true}})}
        const out = gen_copyright_typst(make_blueprint(), resources)
        expect(out).toContain('freely copied and shared')
        expect(out).not.toContain('modified')
    })

    it('still allows modification under share-alike', () => {
        // Share-alike is a condition on modification, not a ban on it
        const resources = {eng_bsb: make_resource('eng_bsb',
            {restrictions: {forbid_derivatives: 'same-license'}})}
        const out = gen_copyright_typst(make_blueprint(), resources)
        expect(out).toContain('freely copied, modified, and translated')
    })

    it('makes no blanket claim when a translation needs permission', () => {
        const resources = {eng_bsb: make_resource('eng_bsb',
            {restrictions: {forbid_other: true}})}
        const out = gen_copyright_typst(make_blueprint(), resources)
        expect(out).not.toContain('freely copied')
    })

    it('makes no blanket claim when the creator reserves rights', () => {
        // public_domain off means the creator's own material forbids "other" uses, which is
        // enough on its own to drop the blanket statement
        const out = gen_copyright_typst(make_blueprint({public_domain: false}), RESOURCES)
        expect(out).not.toContain('freely copied')
    })

    it('takes the strictest terms across two translations', () => {
        const resources = {
            eng_bsb: make_resource('eng_bsb'),
            xyz_str: make_resource('xyz_str', {restrictions: {forbid_derivatives: true}}),
        }
        const out = gen_copyright_typst(
            make_blueprint({bibles: ['eng_bsb', 'xyz_str']}), resources)
        expect(out).toContain('freely copied and shared')
    })
})


describe('attribution rows', () => {

    it('lists each translation with its name and attribution', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES)
        expect(out).toContain('Resources used:')
        expect(out).toContain('- Berean Standard Bible — BSB Committee (CC0)')
    })

    it('falls back to the English name when there is no local one', () => {
        const resources = {eng_bsb: make_resource('eng_bsb',
            {name_local: '', name_english: 'English Name'})}
        expect(gen_copyright_typst(make_blueprint(), resources)).toContain('English Name')
    })

    it('shows a license URL only for a license with no well-known id', () => {
        const known = gen_copyright_typst(make_blueprint(), RESOURCES)
        expect(known).not.toContain('https://example.org/license')

        const resources = {eng_bsb: make_resource('eng_bsb',
            {license_id: null, license_url: 'https://example.org/license'})}
        expect(gen_copyright_typst(make_blueprint(), resources))
            .toContain('https://example.org/license')
    })

    it('adds a study-notes row when notes are enabled', () => {
        const out = gen_copyright_typst(make_blueprint({notes: 'tyndale'}), RESOURCES)
        expect(out).toContain('Study notes — Tyndale House Publishers')
    })

    it('lists one row per selected translation', () => {
        const resources = {
            eng_bsb: make_resource('eng_bsb', {name_local: 'First'}),
            xyz_str: make_resource('xyz_str', {name_local: 'Second'}),
        }
        const out = gen_copyright_typst(
            make_blueprint({bibles: ['eng_bsb', 'xyz_str']}), resources)
        expect(out).toContain('First')
        expect(out).toContain('Second')
    })

    it('escapes Typst-significant characters in a translation name', () => {
        const resources = {eng_bsb: make_resource('eng_bsb', {name_local: 'Name #with $markup'})}
        const out = gen_copyright_typst(make_blueprint(), resources)
        expect(out).not.toContain('Name #with $markup')
        expect(out).toContain('\\#')
    })
})


describe('creator material', () => {

    it('adds the public-domain dedication when opted in', () => {
        expect(gen_copyright_typst(make_blueprint(), RESOURCES))
            .toContain('dedicated to the public domain')
    })

    it('omits the dedication when rights are reserved', () => {
        expect(gen_copyright_typst(make_blueprint({public_domain: false}), RESOURCES))
            .not.toContain('dedicated to the public domain')
    })
})


describe('app and design links', () => {

    it('adds the "Created with" line when app_link is on', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES)
        expect(out).toContain('Created with')
        expect(out).toContain('https://paper.bible')
    })

    it('omits it when app_link is off', () => {
        expect(gen_copyright_typst(make_blueprint({app_link: false}), RESOURCES))
            .not.toContain('Created with')
    })

    it('adds a QR code and link when design_link is on and a url is given', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES,
            'https://paper.bible/designs/d1/v1')
        expect(out).toContain('Customize and print this yourself')
        expect(out).toContain('curve.move(')
        expect(out).toContain('link("https://paper.bible/designs/d1/v1")')
    })

    it('shows the url without its scheme but links to the full one', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES,
            'https://paper.bible/designs/d1/v1')
        expect(out).toContain('[paper.bible/designs/d1/v1]')
    })

    it('omits the QR block when design_link is off', () => {
        const out = gen_copyright_typst(make_blueprint({design_link: false}), RESOURCES,
            'https://paper.bible/designs/d1/v1')
        expect(out).not.toContain('Customize and print this yourself')
        expect(out).not.toContain('curve.move(')
    })

    it('omits the QR block when no url is supplied', () => {
        expect(gen_copyright_typst(make_blueprint(), RESOURCES))
            .not.toContain('Customize and print this yourself')
    })
})


describe('block structure', () => {

    it('scopes its paragraph overrides to a content block', () => {
        const out = gen_copyright_typst(make_blueprint(), RESOURCES)
        expect(out.startsWith('#[')).toBe(true)
        expect(out.trimEnd().endsWith(']')).toBe(true)
        expect(out).toContain('#set par(first-line-indent: 0em')
    })

    it('renders with no translations selected at all', () => {
        const out = gen_copyright_typst(make_blueprint({bibles: [] as unknown as [string]}), {})
        expect(out).toContain('Resources used:')
    })
})
