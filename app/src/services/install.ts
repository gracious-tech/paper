
// Installing the app (public/manifest.json makes it installable). It's offered only where the
// browser itself can install it in one step: Chromium-based browsers fire `beforeinstallprompt`
// once a page meets their install criteria, and that event's prompt() is the browser's own
// install dialog, which the designs list offers in a notice the user can dismiss for good. Where
// it never fires — Safari, Firefox, the in-app browsers of Facebook and
// the like, an app that's already installed — nothing is offered, rather than instructions for
// an install that may not work there. The browser's own suggestions are left alone too (no
// preventDefault()), so it can still recommend installing to someone who uses the app a lot

import {ref, computed} from 'vue'


// The event Chromium fires when the app can be installed (not in TypeScript's DOM types)
interface BeforeInstallPromptEvent extends Event {
    prompt():Promise<{outcome:'accepted'|'dismissed'}>
}


// The browser's standing offer to install, if any. One event can only prompt once, and the
// browser fires a fresh one later if that prompt is dismissed
let offer:BeforeInstallPromptEvent|null = null

// Whether the browser can install the app right now
export const can_install = ref(false)


// localStorage key recording that the user turned down installing, in this browser
const DISMISSED_KEY = 'install_dismissed'


// Whether the user has turned down installing (closed the notice, or cancelled the browser's
// install dialog), as stored
function read_dismissed():boolean{
    try {
        return localStorage.getItem(DISMISSED_KEY) === 'true'
    } catch {
        // Private mode / blocked storage, or no storage at all (tests)
        return false
    }
}

const dismissed = ref(read_dismissed())


// Whether to offer installing: the browser can, and the user hasn't said no
export const offer_install = computed(() => can_install.value && !dismissed.value)


// Stop offering to install in this browser
export function dismiss_install():void{
    dismissed.value = true
    try {
        localStorage.setItem(DISMISSED_KEY, 'true')
    } catch {
        // Never fail over a cosmetic preference (it's still dismissed until the page reloads)
    }
}


// Listen for the browser's install offers (window in the app; any target in tests). Called early
// in boot, since the offer can arrive before the app has mounted
export function listen_for_install(target:EventTarget):void{

    // Keep the offer for when the user asks
    target.addEventListener('beforeinstallprompt', event => {
        offer = event as BeforeInstallPromptEvent
        can_install.value = true
    })

    // Installed some other way (the browser's own menu or address-bar button)
    target.addEventListener('appinstalled', () => {
        offer = null
        can_install.value = false
    })
}


// Show the browser's install dialog, using up the offer whatever the user decides. Cancelling it
// counts as turning installing down, so the notice doesn't come back with the browser's next offer
export async function install_app():Promise<void>{
    const current = offer
    if (!current){
        return
    }
    offer = null
    can_install.value = false
    const {outcome} = await current.prompt()
    if (outcome === 'dismissed'){
        dismiss_install()
    }
}
