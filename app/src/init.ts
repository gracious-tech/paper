
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

import wasm_url from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import {init as init_typst} from 'paper-bible-typst-web'

import AppIcon from './comp/global/AppIcon.vue'
import AppProse from './comp/global/AppProse.vue'
import AppRoot from './comp/AppRoot.vue'
import locales_meta from './locales.json'
import {blue, state} from '@/services/state'
import {content, bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {start_watchers} from '@/services/watchers'
import {clean_blueprint} from '@/services/blueprints'
import {report_error, vue_error_handler} from '@/services/errors'


// Create app
const app = createApp(AppRoot)
app.config.errorHandler = vue_error_handler
app.component('AppIcon', AppIcon)
app.component('AppProse', AppProse)


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
            hideDetails: true,
        },
        VChip: {
            rounded: 'pill',
        }
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

    // Init content state (the shared Bible-content layer owns the collection)
    await bible_content.init()
    content.collection = bible_content.collection
    content.translations = content.collection.get_resources({object: true})
    content.languages = content.collection.get_languages({object: true})

    // Initialise the in-browser Typst compiler (non-blocking — preview waits on it).
    // Fonts are served from the public dir under this assets prefix (see .bin/setup).
    const assets_prefix = new URL('/generator_assets/', window.location.href).href
    void init_typst({wasm_url, assets_prefix}).then(generator => {
        typst_generator.value = generator
    }).catch((error:unknown) => {
        report_error('banner', error)
    })

    // Init draft blueprint (TODO load from online storage when available)
    Object.assign(blue, clean_blueprint(undefined))

    // Start on guide tab if first time
    if (state.splash){
        state.tab = 'help'
    }

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Mount app
    app.mount('#app')
})()
