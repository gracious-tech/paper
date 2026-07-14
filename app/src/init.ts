
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

import AppIcon from './comp/global/AppIcon.vue'
import AppProse from './comp/global/AppProse.vue'
import AppColor from './comp/global/AppColor.vue'
import AppFontSelect from './comp/global/AppFontSelect.vue'
import AppRoot from './comp/AppRoot.vue'
import locales_meta from './locales.json'
import {state, selected_id, creations, show_toast} from '@/services/state'
import {ensure_signed_in, complete_email_link} from '@/services/auth'
import {init_drafts, start_draft_sync, redeem_draft_share, current_draft_id}
    from '@/services/drafts'
import {start_creations_sync, creations_loaded} from '@/services/creations'
import {content, bible_content, load_fonts} from '@/services/content'
import {typst_generator, TypstWorkerClient} from '@/services/typst'
import {custom_fonts, restore_custom_fonts} from '@/services/custom_fonts'
import {start_watchers} from '@/services/watchers'
import {report_error, vue_error_handler} from '@/services/errors'
import {parse_boot_url, init_router, set_translator} from '@/services/router'


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
    // Fonts live under `${assets_prefix}fonts/` — served by vite_plugin_fonts.ts in dev, and
    // from a dedicated CORS-enabled bucket in production (see .bin/deploy_fonts)
    const assets_prefix = import.meta.env.DEV
        ? new URL('/generator_assets/', window.location.href).href
        : 'https://fonts.paper.bible/'
    const typst_client = new TypstWorkerClient()
    void typst_client.init(assets_prefix).then(async () => {
        typst_generator.value = typst_client
        // The worker holds a snapshot of uploaded fonts — custom_fonts.ts re-sends after each
        // upload, and this covers any uploads that happened before the worker was ready
        await typst_client.set_custom_fonts(custom_fonts)
    }).catch((error:unknown) => {
        report_error('banner', error)
    })

    // Load the curated font manifest for the style picker (see OptionsStyle.vue)
    void load_fonts(`${assets_prefix}fonts/`)
        .catch((error:unknown) => {
            report_error('banner', error)
        })

    // Handle the URL the app was loaded with (one of the clean paths router.ts maintains:
    // /draft/{id}, /draft/{id}/invite/{token}, /creation/{id}, /creation, /help)
    const boot_url = parse_boot_url()
    let shared_draft_id:string|null = null
    let pending_creation_id:string|undefined
    if (boot_url?.kind === 'draft_invite'){
        // Become an editor now so the draft can simply be opened below, then strip the secret
        // token from the URL immediately — it must never persist in history
        try {
            await redeem_draft_share(boot_url.id, boot_url.token)
            shared_draft_id = boot_url.id
        } catch (error){
            report_error('banner', error)
        }
        history.replaceState(null, '', `/draft/${boot_url.id}`)
    } else if (boot_url?.kind === 'draft'){
        shared_draft_id = boot_url.id
    } else if (boot_url?.kind === 'creation'){
        // Owned vs shared can't be known until the creations list has loaded — resolve without
        // blocking mount on it (see init_router below for how the URL stays put meanwhile)
        pending_creation_id = boot_url.id
        const creation_id = boot_url.id
        void creations_loaded.then(() => {
            if (creations.some(item => item.id === creation_id)){
                state.tab = 'history'
                selected_id.value = creation_id
            } else {
                // Show the shared-creation landing dialog once mounted (see AppRoot.vue)
                state.shared_creation = {id: creation_id}
                state.splash = false
            }
        })
    } else if (boot_url?.kind === 'tab'){
        state.tab = boot_url.tab
    }

    // Load the user's drafts and open the shared/most recent one (creating their first if
    // none), then start auto-saving edits back to Firestore
    await init_drafts(shared_draft_id)
    if (shared_draft_id && current_draft_id.value !== shared_draft_id){
        show_toast(i18n.global.t("Couldn't open that design — you may not have access"))
    }
    start_draft_sync()

    // Keep the creation history mirrored from Firestore
    start_creations_sync()

    // Restore the user's uploaded fonts from their online library (non-blocking; pushes to
    // the compiler worker itself once loaded)
    void restore_custom_fonts().catch((error:unknown) => {
        report_error('banner', error)
    })

    // Start on guide tab if first time
    if (state.splash){
        state.tab = 'help'
    }

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Start syncing the URL with app state, then mount
    set_translator(i18n.global.t)
    init_router(pending_creation_id)
    app.mount('#app')
})()
