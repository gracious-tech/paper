
import {computed} from 'vue'
import {useDisplay} from 'vuetify'

import type {ComputedRef} from 'vue'


// The app's own mobile breakpoint: at or below this width AppRoot stops width-capping
// .v-application (see AppRoot.vue), so the layout fills the real viewport instead of the
// phone-sized centred column
export const MOBILE_MAX_WIDTH = 900


// Whether the viewport is at or below the app's mobile breakpoint. Must be called from a
// component's setup() (it wraps Vuetify's useDisplay) — used to make form dialogs go
// fullscreen on mobile
export function use_is_mobile():ComputedRef<boolean>{
    const {width} = useDisplay()
    return computed(() => width.value <= MOBILE_MAX_WIDTH)
}

