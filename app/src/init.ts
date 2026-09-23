
// MUST come first
import '@/services/errors.sss'
import '@/services/errors'

// Polyfills
import 'core-js/actual/array/at'  // Used by Vuetify
import 'core-js/actual/object/has-own'  // Used by Vuetify?
import 'core-js/actual/array/to-sorted'  // Used by Vuetify's list filtering (Safari < 16)

// Embed global styles
import './styles.sss'
import 'vuetify/styles'

import {createApp, defineAsyncComponent} from 'vue'
import {createVuetify} from 'vuetify'
import {md3} from 'vuetify/blueprints'
import CheckboxBlank from '@material-symbols/svg-400/rounded/check_box_outline_blank.svg'
import Checkbox from '@material-symbols/svg-400/rounded/check_box.svg'
import RadioChecked from '@material-symbols/svg-400/rounded/radio_button_checked.svg'
import RadioUnchecked from '@material-symbols/svg-400/rounded/radio_button_unchecked.svg'
import ExpandMore from '@material-symbols/svg-400/rounded/expand_more.svg'
import Check from '@material-symbols/svg-400/rounded/check.svg'
import Warning from '@material-symbols/svg-400/rounded/warning-fill.svg'
import Info from '@material-symbols/svg-400/rounded/info-fill.svg'
import ErrorIcon from '@material-symbols/svg-400/rounded/error-fill.svg'
import CheckCircle from '@material-symbols/svg-400/rounded/check_circle-fill.svg'

import AppIcon from './comp/global/AppIcon.vue'
import AppColor from './comp/global/AppColor.vue'
import AppFontSelect from './comp/global/AppFontSelect.vue'
import AppOptionToggle from './comp/global/AppOptionToggle.vue'
import AppRoot from './comp/AppRoot.vue'
import locales_meta from './locales.json'
import {i18n, load_locale, translate} from '@/services/i18n'
import {show_toast} from '@/services/state'
import {detect_locale} from '@/services/locale'
import {router} from '@/services/router'
import {ensure_signed_in, is_email_link, stored_email_for_link, complete_email_link}
    from '@/services/auth'
import {finish_email_link} from '@/services/account'
import {init_designs, start_design_sync, start_viewed_sync} from '@/services/designs'
import {content, bible_content, load_fonts} from '@/services/content'
import {typst_generator, TypstWorkerClient, ASSETS_PREFIX} from '@/services/typst'
import {custom_fonts} from '@/services/custom_fonts'
import {start_watchers} from '@/services/watchers'
import {report_error, vue_error_handler} from '@/services/errors'


// Create app
const app = createApp(AppRoot)
app.config.errorHandler = vue_error_handler
app.component('AppIcon', AppIcon)
// Async: AppProse is the tiptap rich-text editor, ~100KB gzipped of ProseMirror that only the
// custom-page and picture-story editors ever mount. Warmed in the background after boot (see
// the prefetch below) so opening one of those doesn't wait on the network
app.component('AppProse', defineAsyncComponent(() => import('./comp/global/AppProse.vue')))
app.component('AppColor', AppColor)
app.component('AppFontSelect', AppFontSelect)
app.component('AppOptionToggle', AppOptionToggle)


// Register i18n — eng is bundled as the fallback, the detected locale is fetched on demand
app.use(i18n)
const app_locale = detect_locale(locales_meta.supported)
if (app_locale !== 'eng'){
    void load_locale(app_locale).catch(() => {
        // Non-essential — the app stays usable in English
        console.error(`Failed to load i18n for ${app_locale}`)
    })
}


// Add Vuetify
app.use(createVuetify({
    blueprint: md3,
    theme: {
        defaultTheme: 'custom',
        themes: {
            custom: {
                dark: false,
                colors: {
                    primary: '#642b4c',  // 325deg
                    secondary: '#638cff',
                    // Pale tint of primary — used for toggle-button active state on dark surfaces
                    'primary-light': '#e3d3de',
                    // Reads as "all good" against the plum header — the signed-in account icon
                    'success-light': '#a5d6a7',
                },
            },
        },
        variations: {
            colors: ['primary', 'secondary', 'error', 'warning'],
            lighten: 2,
            darken: 2,
        },
    },
    defaults: {
        // 'auto' collapses the details row when a field has nothing to show (plain hints are
        // now rendered via the .hint class instead), but still reserves it for error-messages
        global: {
            hideDetails: 'auto',
        },
        VChip: {
            rounded: 'pill',
        },
        VCheckbox: {
            color: 'primary',
        },
        VRadioGroup: {
            color: 'primary',
        },
        VSlider: {
            color: 'primary',
        },
        VBtnToggle: {
            color: 'primary',
        },
    },
    icons: {
        aliases: {
            checkboxOn: Checkbox,
            checkboxOff: CheckboxBlank,
            radioOn: RadioChecked,
            radioOff: RadioUnchecked,
            dropdown: ExpandMore,
            complete: Check,
            warning: Warning,
            info: Info,
            error: ErrorIcon,
            success: CheckCircle,
        },
    },
}))


// Wait for critical services before mounting
void (async () => {

    // Sign in (anonymously if no persisted user) and init the Bible-content layer in parallel
    // (auth must resolve before any Firestore/Storage access below).
    // NOTE The content layer can't be deferred past the mount: the designs layer reads
    // `content.collection`/`content.translations` throughout (clean_blueprint and
    // get_default_blueprint in blueprints.ts, content_summary via meta_from_doc), so nothing
    // below this line can run without it
    await Promise.all([ensure_signed_in(), bible_content.init()])

    // If arriving via a passwordless email sign-in link, take the URL now and clean it — the
    // code is single-use, so if the address stayed sign-in-shaped every later refresh would
    // retry a spent code. Captured before the router is installed below, which would otherwise
    // normalise the query away
    const sign_in_link = is_email_link(location.href) ? location.href : null
    if (sign_in_link){
        history.replaceState(null, '', location.pathname)
    }

    // Complete it before loading any user data (it may switch to an existing account and merge
    // the guest's data into it) — but only when this browser is the one that requested the
    // link and so knows the address. Opened on another device, the address can only be asked
    // for, and a dialog needs the app mounted, so that case is deferred to after the mount
    const link_email = sign_in_link ? stored_email_for_link() : null
    const email_link = sign_in_link && link_email
        ? await complete_email_link(sign_in_link, link_email).catch((error:unknown) => {
            report_error('banner', error)
            return null
        })
        : null

    // A spent or stale link is a normal outcome, so say so rather than leaving the user wondering
    // why clicking it did nothing (the toast waits in state until the app mounts below)
    if (email_link === 'expired'){
        show_toast(translate('app.sign_in_link_expired'))
    }
    content.collection = bible_content.collection
    content.translations = content.collection.get_resources({object: true})
    content.languages = content.collection.get_languages({object: true})

    // Initialise the in-browser Typst compiler in a Web Worker (non-blocking — preview waits
    // on it, and compilation runs off the main thread so it never lags the UI).
    // Fonts live under `${ASSETS_PREFIX}fonts/` — the shared assets tree published by the
    // bookcover repo (its dev server in dev, the CORS-enabled bucket in production)
    const typst_client = new TypstWorkerClient()
    void typst_client.init(ASSETS_PREFIX).then(async () => {
        typst_generator.value = typst_client
        // The worker holds a snapshot of uploaded fonts — custom_fonts.ts re-sends after each
        // upload, and this covers any uploads that happened before the worker was ready
        await typst_client.set_custom_fonts(custom_fonts)
    }).catch((error:unknown) => {
        report_error('banner', error)
    })

    // Load the curated font manifest for the style picker (see OptionsStyle.vue)
    void load_fonts(`${ASSETS_PREFIX}fonts/`)
        .catch((error:unknown) => {
            report_error('banner', error)
        })

    // Load the user's designs and open whichever one the boot URL names (if any and if
    // accessible), else the most recent one, else create their first. A bare regex match is
    // enough here — it's just a hint to avoid opening then immediately re-opening a different
    // design; ViewDesign.vue independently opens whatever the resolved route names once mounted
    const boot_match = location.pathname.match(/^\/designs\/([^/]+)/)
    await init_designs(boot_match ? boot_match[1]! : null)
    start_design_sync()

    // Keep the version-viewing history mirrored from Firestore ("Read access" on /designs)
    start_viewed_sync()

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Start the router (resolves the current location automatically), then mount
    app.use(router)
    app.mount('#app')

    // Deferred from above: a sign-in link opened on a device that never requested it. Now the
    // app can render a dialog, ask which address it was sent to and finish the sign-in
    if (sign_in_link && !link_email){
        void finish_email_link(sign_in_link)
    }

    // Warm the async chunks that a user is likely to reach but that no first paint needs, once
    // the browser is otherwise idle. Splitting them out keeps them off the critical path; this
    // keeps that from turning into a wait the first time one is opened. Failures are ignored —
    // the same import is retried for real when the component actually mounts
    const prefetch = () => {
        void import('./comp/global/AppProse.vue').catch(() => undefined)
    }
    if ('requestIdleCallback' in window){
        requestIdleCallback(prefetch, {timeout: 10000})
    } else {
        setTimeout(prefetch, 3000)
    }
})()
