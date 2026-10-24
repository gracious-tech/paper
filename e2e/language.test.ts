
// The UI's language: detected from the browser, chosen from the header menu, remembered, and
// carried into everything that isn't our own catalog — the page's lang/dir and Vuetify's layout.
// Expected text is read from the catalogs themselves, so a retranslation never breaks these

import {readFileSync} from 'node:fs'

import {test, expect, boot, active_dialog, UI_TIMEOUT} from './fixtures'
import {ROOT} from './stack'

import type {Page} from '@playwright/test'


test.describe.configure({timeout: UI_TIMEOUT})


// A UI string in a given locale, straight from its catalog
function catalog(locale:string, key:string):string{
    const strings = JSON.parse(readFileSync(`${ROOT}app/src/locales/${locale}.json`, 'utf8')) as
        Record<string, string>
    return strings[key]!
}


// Choose a language from the header menu's language dialog, whose labels are in the UI's current
// language (`from`)
async function choose_language(page:Page, name:string, from = 'en'):Promise<void>{
    await page.locator('header h1').getByRole('button').last().click()
    await page.locator('.v-overlay--active .v-list-item')
        .filter({hasText: catalog(from, 'app.language')}).click()
    const dialog = active_dialog(page)
    await dialog.getByPlaceholder(catalog(from, 'common.search')).fill(name)
    await dialog.locator('.v-list-item').filter({hasText: name}).click()
}


test('English by default', async ({page}) => {
    await boot(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByText(catalog('en', 'view.designs.no_designs_yet'))).toBeVisible()
})


test.describe('a browser set to Brazilian Portuguese', () => {
    test.use({locale: 'pt-BR'})

    test('gets the app in Portuguese from the start', async ({page}) => {
        await boot(page)
        await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
        await expect(page.getByText(catalog('pt-BR', 'view.designs.no_designs_yet')))
            .toBeVisible()
        await expect(page.getByRole('button', {name: catalog('pt-BR', 'common.new'),
            exact: true})).toBeVisible()
    })
})


test.describe('a browser set to European Portuguese', () => {
    test.use({locale: 'pt-PT'})

    test('is matched to the nearest catalog', async ({page}) => {
        // There's no pt-PT catalog, and Brazilian Portuguese is far closer than English
        await boot(page)
        await expect(page.getByText(catalog('pt-BR', 'view.designs.no_designs_yet')))
            .toBeVisible()
    })
})


test('choosing a language switches the UI and is remembered', async ({page}) => {
    await boot(page)
    await choose_language(page, 'Español')

    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByText(catalog('es', 'view.designs.no_designs_yet'))).toBeVisible()

    await page.reload()
    await expect(page.getByText(catalog('es', 'view.designs.no_designs_yet')))
        .toBeVisible({timeout: 60_000})
})


test('a right-to-left language turns the layout around', async ({page}) => {
    await boot(page)
    await choose_language(page, 'العربية')

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('.v-locale--is-rtl').first()).toBeAttached()
    await expect(page.getByText(catalog('ar', 'view.designs.no_designs_yet'))).toBeVisible()

    // And back again
    await choose_language(page, 'English', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.getByText(catalog('en', 'view.designs.no_designs_yet'))).toBeVisible()
})


test('the wizard is translated too, down to the type pictures', async ({page}) => {
    await boot(page)
    await choose_language(page, 'Español')

    await page.getByRole('button', {name: catalog('es', 'common.new'), exact: true}).click()
    await expect(page.getByText(catalog('es', 'wizard.type.question'))).toBeVisible()
    // Each locale gets the type pictures rendered in its own Bible (see gen_type_images)
    const picture = page.locator('.wizard .v-window-item--active img').first()
    await expect(picture).toHaveAttribute('src', /design_types\/es\//)
})
