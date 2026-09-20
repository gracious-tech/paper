
// Switching the signed-in account mid-session: releasing the outgoing account's Firestore
// listeners and loading the incoming account's data. Shared by DialogAccount.vue (Google
// link/merge and sign out) and init.ts (a sign-in link opened on a device that didn't
// request it), which all leave the app running under a different uid than it started with

import {prompt_dialog, show_toast} from '@/services/state'
import {complete_email_link} from '@/services/auth'
import {init_designs, start_viewed_sync, stop_design_sync} from '@/services/designs'
import {stop_versions_sync} from '@/services/versions'
import {report_error} from '@/services/errors'
import {translate} from '@/services/i18n'


// Tear down the outgoing account's Firestore listeners before its access goes away
export function release_user_data():void{
    stop_design_sync()
    stop_versions_sync()
}


// Reload designs/versions after the account (uid) changed — merging into an existing account
// or signing out both switch to a different uid's data
// NOTE The design auto-save watcher from boot persists (it follows whatever design is open);
// ViewDesign.vue's own watcher restarts the scoped versions sync once current_design_id settles
export async function reload_user_data(welcome = true):Promise<void>{
    // Uploaded fonts belong to a design, so opening one loads them — nothing account-wide
    // to restore here
    await init_designs(null, welcome)
    start_viewed_sync()
}


// Finish a passwordless sign-in whose link was opened on a device that never requested it, so
// the address it was sent to isn't in this browser's storage and can only be asked for. Unlike
// the ordinary path (completed during boot, before any user data loads) this runs after the
// app has mounted, since a dialog needs somewhere to render — hence the reload afterwards,
// which swaps the guest's freshly-loaded data for whichever account the link resolved to
export async function finish_email_link(link:string):Promise<void>{
    const email = (await prompt_dialog(translate('app.confirm_email')))?.trim()
    if (!email){
        // Cancelled, or nothing entered — the link is spent either way, so stay a guest
        return
    }
    try {
        // Completing may sign in as a different account, so let go of this one's data first
        release_user_data()
        if (await complete_email_link(link, email) === 'expired'){
            show_toast(translate('app.sign_in_link_expired'))
        }
        // Either outcome needs this: the account resolved, or the guest's listeners are gone
        await reload_user_data(false)
    } catch (error){
        report_error('banner', error)
    }
}
