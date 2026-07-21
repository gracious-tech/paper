
// MUST come first
import '@/services/errors.sass'
import '@/services/errors'

// Polyfills
import 'core-js/actual/array/at'  // Used by Vuetify
import 'core-js/actual/object/has-own'  // Used by Vuetify?

// Embed global styles
import './styles.sass'
import 'vuetify/styles'

import {createApp} from 'vue'
import {createVuetify} from 'vuetify'
import {createI18n} from 'vue-i18n'
import {md3} from 'vuetify/blueprints'
import CheckboxBlank from '@material-symbols/svg-400/rounded/check_box_outline_blank.svg'
import Checkbox from '@material-symbols/svg-400/rounded/check_box.svg'
import RadioChecked from '@material-symbols/svg-400/rounded/radio_button_checked.svg'
import RadioUnchecked from '@material-symbols/svg-400/rounded/radio_button_unchecked.svg'
import ExpandMore from '@material-symbols/svg-400/rounded/expand_more.svg'
import Check from '@material-symbols/svg-400/rounded/check.svg'

import AppIcon from './comp/global/AppIcon.vue'
import AppProse from './comp/global/AppProse.vue'
import AppColor from './comp/global/AppColor.vue'
import AppFontSelect from './comp/global/AppFontSelect.vue'
import AppRoot from './comp/AppRoot.vue'
import locales_meta from './locales.json'
import {router} from '@/services/router'
import {ensure_signed_in, complete_email_link} from '@/services/auth'
import {init_designs, start_design_sync, start_viewed_sync} from '@/services/designs'
import {content, bible_content, load_fonts} from '@/services/content'
import {typst_generator, TypstWorkerClient, ASSETS_PREFIX} from '@/services/typst'
import {custom_fonts, restore_custom_fonts} from '@/services/custom_fonts'
import {start_watchers} from '@/services/watchers'
import {report_error, vue_error_handler} from '@/services/errors'


// Create app
const app = createApp(AppRoot)
app.config.errorHandler = vue_error_handler
app.component('AppIcon', AppIcon)
app.component('AppProse', AppProse)
app.component('AppColor', AppColor)
app.component('AppFontSelect', AppFontSelect)


// Register i18n
const lower_lang = navigator.language.toLowerCase()
let browser_locale = lower_lang.split('-')[0] ?? 'en'
if (browser_locale === 'zh' && ['hant', 'tw', 'hk', 'mo'].includes(lower_lang.split('-')[1] ?? '')){
    browser_locale = 'zh-hant'  // Such countries primarily use traditional script
}
const i18n = createI18n({
    legacy: false,
    locale: browser_locale,
    missingWarn: false,  // TODO remove when i18n fully implemented
})
app.use(i18n)
// WARN en shouldn't be included in `supported` array as it maps to empty strings for testing only
if (locales_meta.supported.includes(browser_locale)){
    void import(`./locales/${browser_locale}.json`).then(messages => {
        i18n.global.setLocaleMessage(browser_locale, messages.default)
    }).catch(() => {
        // Don't result in error banner as non-essential
        console.error(`Failed to load i18n for ${browser_locale}`)
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
                },
            },
        },
        variations: {
            colors: ['primary', 'secondary'],
            lighten: 2,
            darken: 2,
        },
    },
    defaults: {
        global: {
            persistentHint: true,
        },
        VChip: {
            rounded: 'pill',
        },
        VCheckbox: {
            hideDetails: true,
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
        },
    },
}))


// Wait for critical services before mounting
void (async () => {

    // Sign in (anonymously if no persisted user) and init the Bible-content layer in parallel
    // (auth must resolve before any Firestore/Storage access below)
    await Promise.all([ensure_signed_in(), bible_content.init()])

    // If arriving via a passwordless email sign-in link, complete it before loading any user
    // data (may switch to an existing account and merge the guest's data into it)
    await complete_email_link().catch((error:unknown) => {
        report_error('banner', error)
    })
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

    // Restore the user's uploaded fonts from their online library (non-blocking; pushes to
    // the compiler worker itself once loaded)
    void restore_custom_fonts().catch((error:unknown) => {
        report_error('banner', error)
    })

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Start the router (resolves the current location automatically), then mount
    app.use(router)
    app.mount('#app')
})()
