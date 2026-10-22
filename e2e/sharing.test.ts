
// The two ways a document reaches someone else, end to end through the real app.
//
// They are deliberately different capability models, and that difference is what these check.
// A design id is not enough on its own — editing is a permission grant, so an invite link
// carries a share token the server validates before adding anyone as an editor. A version id
// *is* the whole capability: it's an unguessable token, so viewing needs no grant at all, and
// "keep my own copy" is the only part that needs the server.

import {test, expect, boot, UI_TIMEOUT} from './fixtures'
import {admin_db, seed_shared_version, new_id} from './helpers/admin'


test.describe.configure({timeout: UI_TIMEOUT})


// The other party in every journey here — a real uid that isn't the browser's
const OTHER_USER = 'e2e_other_user'


// A design's editor list, straight from Firestore
async function editors_of(design_id:string):Promise<string[]>{
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    return (snap.data()?.['editor_uids'] ?? []) as string[]
}


test.describe('design invite links', () => {

    test('accepting one grants edit access', async ({page}) => {
        const uid = await boot(page)
        const {design_id, share_token} = await seed_shared_version(OTHER_USER)
        expect(await editors_of(design_id)).toEqual([OTHER_USER])

        await page.goto(`/designs/${design_id}/invite/${share_token}`)

        // The invite is previewed, not redeemed, until the user says yes
        await expect(page.getByText('You\'ve been granted edit access to this document.'))
            .toBeVisible({timeout: 30_000})
        expect(await editors_of(design_id)).toEqual([OTHER_USER])

        // An invite link lands on /designs/:id with no version, which resolves to the design's
        // latest — so the read-only landing prompt is a candidate to open at the same time.
        // It must not, or it sits on top of these buttons and swallows the clicks
        await expect(page.getByText('Someone shared this document with you.')).toBeHidden()

        await page.getByRole('button', {name: 'Accept', exact: true}).click()

        await expect.poll(() => editors_of(design_id), {timeout: 30_000})
            .toEqual([OTHER_USER, uid])
        // And the token is stripped from the URL either way
        await expect(page).toHaveURL(new RegExp(`/designs/${design_id}$`))
    })

    test('ignoring one grants nothing', async ({page}) => {
        await boot(page)
        const {design_id, share_token} = await seed_shared_version(OTHER_USER)

        await page.goto(`/designs/${design_id}/invite/${share_token}`)
        await page.getByRole('button', {name: 'Ignore', exact: true}).click({timeout: 30_000})

        await expect(page.getByText('You\'ve been granted edit access to this document.'))
            .toBeHidden()
        expect(await editors_of(design_id)).toEqual([OTHER_USER])

        // Declining edit access still leaves a readable document, so the read-only prompt —
        // held back while the invite was unanswered — is the right thing to ask next
        await expect(page.getByText('Someone shared this document with you.'))
            .toBeVisible({timeout: 30_000})
    })

    test('a wrong token is refused, and the design id alone is not enough', async ({page}) => {
        await boot(page)
        const {design_id} = await seed_shared_version(OTHER_USER)

        await page.goto(`/designs/${design_id}/invite/${new_id()}`)

        await expect(page.getByText('This invite link is invalid or has been disabled.'))
            .toBeVisible({timeout: 30_000})
        expect(await editors_of(design_id)).toEqual([OTHER_USER])
    })

    test('a revoked link stops working', async ({page}) => {
        await boot(page)
        const {design_id, share_token} = await seed_shared_version(OTHER_USER)
        // What "reset link" does on the owner's side
        await admin_db.doc(`designs/${design_id}`).update({share_token: new_id()})

        await page.goto(`/designs/${design_id}/invite/${share_token}`)

        await expect(page.getByText('This invite link is invalid or has been disabled.'))
            .toBeVisible({timeout: 30_000})
        expect(await editors_of(design_id)).toEqual([OTHER_USER])
    })
})


test.describe('shared versions', () => {

    test('a version link opens read-only, without granting edit access', async ({page}) => {
        const uid = await boot(page)
        const {design_id, version_id} = await seed_shared_version(OTHER_USER)

        await page.goto(`/designs/${design_id}/${version_id}`)

        await expect(page.getByText('Someone shared this document with you.'))
            .toBeVisible({timeout: 30_000})
        await page.getByRole('button', {name: 'View', exact: true}).click()

        // Read access is recorded, but membership of the design is untouched
        await expect.poll(async () =>
            (await admin_db.doc(`users/${uid}/viewed/${design_id}`).get()).exists,
        {timeout: 30_000}).toBe(true)
        expect(await editors_of(design_id)).toEqual([OTHER_USER])
    })

    test('the short link resolves to the same version', async ({page}) => {
        await boot(page)
        const {design_id, version_id} = await seed_shared_version(OTHER_USER)

        // What a printed QR code points at
        await page.goto(`/v/${version_id}`)

        await expect(page).toHaveURL(
            new RegExp(`/designs/${design_id}/${version_id}$`), {timeout: 30_000})
    })

    test('keeping a copy creates a design and a version of the viewer\'s own',
        async ({page}) => {
            const uid = await boot(page)
            const {design_id, version_id} = await seed_shared_version(OTHER_USER)

            await page.goto(`/designs/${design_id}/${version_id}`)
            await page.getByRole('button', {name: 'View', exact: true}).click({timeout: 30_000})
            await page.getByRole('button', {name: 'Keep my own copy', exact: true}).click({timeout: 30_000})

            // A new version of the viewer's own, pointing back at the one they were shown
            const own_versions = async () => await admin_db.collection('versions')
                .where('owner', '==', uid).get()
            await expect.poll(async () => (await own_versions()).size, {timeout: 60_000})
                .toBe(1)

            const copy = (await own_versions()).docs[0]!.data()
            expect(copy['copied_from']).toBe(version_id)
            expect(copy['design_id']).not.toBe(design_id)

            // ...and a design of their own to go on editing
            const design = await admin_db.doc(`designs/${copy['design_id'] as string}`).get()
            expect(design.data()!['owner']).toBe(uid)
            expect(design.data()!['editor_uids']).toEqual([uid])

            // The source is untouched
            expect(await editors_of(design_id)).toEqual([OTHER_USER])
        })
})
