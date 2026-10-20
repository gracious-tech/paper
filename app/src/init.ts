
// MUST come first
import '@/services/errors.sss'
import '@/services/errors'

// Polyfills
import 'core-js/actual/array/at'  // Used by Vuetify
import 'core-js/actual/object/has-own'  // Used by Vuetify?
import 'core-js/actual/array/to-sorted'  // Used by Vuetify's list filtering (Safari < 16)

// Embed global styles
import '@fontsource-variable/roboto'  // Vuetify's UI font (see --v-font-body in styles.sss)
import './styles.sss'
import 'vuetify/styles'

import {createApp, defineAsyncComponent, watch} from 'vue'
import {createVuetify} from 'vuetify'
import {FetchNetworkError} from '@gracious.tech/fetch-client'
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
import AppSentence from './comp/global/AppSentence.vue'
import AppRoot from './comp/AppRoot.vue'
import {i18n, load_locale, translate, initial_locale, locale, locale_dir, vuetify_messages, LOCALES,
    SOURCE_LOCALE} from '@/services/i18n'
import {show_toast, report_failure, health} from '@/services/state'
import {firebase_auth} from '@/services/firebase'
import {router} from '@/services/router'
import {ensure_signed_in, is_email_link, stored_email_for_link, complete_email_link}
    from '@/services/auth'
import {finish_email_link} from '@/services/account'
import {init_designs, start_design_sync, start_viewed_sync} from '@/services/designs'
import {content, bible_content, load_fonts} from '@/services/content'
import {typst_generator, TypstWorkerClient, ASSETS_PREFIX} from '@/services/typst'
import {custom_fonts} from '@/services/custom_fonts'
import {start_watchers} from '@/services/watchers'
import {report_error, vue_error_handler, set_error_translator} from '@/services/errors'


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
app.component('AppSentence', AppSentence)


// Register i18n — eng is bundled as the fallback, the user's locale is fetched during boot (see
// below) so the first paint is already in their language
app.use(i18n)
set_error_translator(translate)
const app_locale = initial_locale()
const locale_ready = app_locale === SOURCE_LOCALE ? Promise.resolve() : load_locale(app_locale)
    .catch((error:unknown) => {
        // Non-essential — the app stays usable in English
        report_error('silent', error, {context: {stage: 'load_locale', locale: app_locale}})
    })


// Add Vuetify
const vuetify = createVuetify({
    blueprint: md3,
    // Vuetify's own strings come from our catalogs (see vuetify_messages), and its RTL layout
    // follows each locale's declared direction
    locale: {
        locale: SOURCE_LOCALE,
        fallback: SOURCE_LOCALE,
        messages: {[SOURCE_LOCALE]: vuetify_messages(SOURCE_LOCALE)},
        rtl: Object.fromEntries(
            Object.keys(LOCALES).map(code => [code, locale_dir(code) === 'rtl'])),
    },
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
})
app.use(vuetify)


// Everything outside our own catalogs that also has to follow the active locale: the page's
// lang/dir (screen readers, hyphenation, RTL layout), Vuetify's strings, and the language of
// the emails Firebase Auth sends (sign-in links)
watch(locale, code => {
    document.documentElement.lang = code
    document.documentElement.dir = locale_dir(code)
    vuetify.locale.messages.value[code] = vuetify_messages(code)
    vuetify.locale.current.value = code
    firebase_auth.languageCode = code
}, {immediate: true})


// Wait for critical services before mounting. Anything that fails here leaves the app unable to
// start, so it shows the failure splash (nothing else would replace the loading spinner)
void (async () => {

    // Sign in (anonymously if no persisted user) and init the Bible-content layer in parallel
    // (auth must resolve before any Firestore/Storage access below), with the UI catalog
    // alongside them since it costs nothing extra there and avoids an English first paint.
    // NOTE The content layer can't be deferred past the mount: the designs layer reads
    // `content.collection`/`content.translations` throughout (clean_blueprint and
    // get_default_blueprint in blueprints.ts, content_summary via meta_from_doc), so nothing
    // below this line can run without it
    await Promise.all([ensure_signed_in(), bible_content.init(), locale_ready])

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
            report_failure(error, translate('app.sign_in_failed'))
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
        // Without the engine nothing can be previewed or generated, so it's flagged to the user
        // (unless it started and only re-sending the uploaded fonts failed)
        if (!typst_generator.value){
            health.engine_failed = true
        }
        report_error('silent', error, {critical: true, context: {stage: 'typst_init'}})
    })

    // Load the curated font manifest for the style picker (see OptionsStyle.vue). Failing only
    // leaves the picker short of fonts, so it's reported but not shown
    void load_fonts(`${ASSETS_PREFIX}fonts/`)
        .catch((error:unknown) => {
            report_error('silent', error, {context: {stage: 'load_fonts'}})
        })

    // Load the user's designs and open whichever one the boot URL names (if any and if
    // accessible), else the most recent one, else create their first. A bare regex match is
    // enough here — it's just a hint to avoid opening then immediately re-opening a different
    // design; ViewDesign.vue independently opens whatever the resolved route names once mounted
    const boot_match = location.pathname.match(/^\/designs\/([^/]+)/)
    await init_designs(boot_match ? boot_match[1]! : null)
    start_design_sync()

    // Keep the version-viewing history mirrored from Firestore ("Read access" on /designs)
    await start_viewed_sync()

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Start the router (resolves the current location automatically), then mount once it has.
    // AppRoot.vue picks the splash or the app by route, so mounting on the unresolved start
    // location would mount (and side-effect) the app only to swap it straight out for the splash
    app.use(router)
    await router.isReady()
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
})().catch((error:unknown) => {
    // fetch.bible failing at the network level (no response at all) means something between the
    // user and it is blocking it, which only they can get around
    const message = error instanceof FetchNetworkError
        ? translate('app.error_content_unreachable') : undefined
    report_error('splash', error, {context: boot_failure_context(error), message})
})


function boot_failure_context(error:unknown):Record<string, string|number>{
    // What a failed boot's message can't say on its own: whether the browser believes it's online
    // or is automated, and for a Firebase network failure the underlying fetch() error it wraps
    // (the SDK keeps that in customData, not its message) — which tells a Google endpoint blocked
    // or unreachable from the user's network apart from a fault of ours
    const context:Record<string, string|number> = {
        online: String(navigator.onLine),
        webdriver: String(navigator.webdriver),
    }
    const custom_data = (error as {customData?:{message?:unknown}}|null)?.customData
    if (typeof custom_data?.message === 'string'){
        context['cause'] = custom_data.message.slice(0, 300)
    }
    return context
}
