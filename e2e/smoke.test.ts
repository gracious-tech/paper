
// Sanity check that the real app boots against the local dev stack (Vite, emulators, content
// server): init.ts only mounts #app once anonymous auth + the content collection resolve

import {test, expect} from '@playwright/test'


test('app boots and mounts', async ({page}) => {
    const errors:string[] = []
    page.on('pageerror', error => {
        errors.push(String(error))
    })
    await page.goto('/')
    // Mounting renders the app's UI inside #app (empty until auth/content init succeed)
    await expect(page.locator('#app *').first()).toBeAttached({timeout: 60_000})
    expect(errors).toEqual([])
})
