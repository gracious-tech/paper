
// Global init for the vendored Coloris color picker (app/src/vendor/coloris — forked from
// mdbassit/Coloris, see that file for patch notes). Coloris binds itself to every input
// matching its `el` selector via event delegation on `document`, so a single global call here
// covers every AppColor instance mounted anywhere in the tree, including ones that don't exist
// yet (opened dialogs, etc.) — no per-component init needed

import Coloris from '@/vendor/coloris/coloris.js'
import '@/vendor/coloris/coloris.css'
import {design_colors} from '@/services/color_palette'


// Whether init_coloris() has already run (re-registering re-adds the document listener)
let initialised = false


// Configure Coloris once. `swatch_label` is the (translated) heading for the row of the open
// design's own colors — passed in because this module has no component scope for $t
export function init_coloris(swatch_label:string):void{
    if (initialised){
        return
    }
    initialised = true

    // Refresh Coloris' swatch row from the open design. Snapshot at open time only —
    // deliberately not a reactive watch, so the row can't shift under the user while they're
    // still picking a color from it
    const apply_swatches = () => {
        Coloris({swatchGroups: [{label: swatch_label, colors: design_colors()}]})
    }

    Coloris({
        el: '[data-coloris]',
        wrap: false,  // we supply our own trigger chrome (AppColor.vue)
        alpha: false,  // blueprint colors are opaque hex; no alpha channel downstream
        format: 'hex',
        formatToggle: true,
        themeMode: 'light',  // the app has a single light Vuetify theme
    })

    apply_swatches()

    // Re-snapshot the swatch row whenever a color trigger is clicked open
    document.addEventListener('click', event => {
        const target = event.target
        if (target instanceof HTMLElement && target.matches('[data-coloris]')){
            apply_swatches()
        }
    })
}
