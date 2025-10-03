
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
import AppHtml from './comp/global/AppHtml.vue'
import AppRoot from './comp/AppRoot.vue'
import locales_meta from './locales.json'
import {blue, creations, state} from '@/services/state'
import {content} from '@/services/content'
import {database} from '@/services/db'
import {start_watchers} from '@/services/watchers'
import {monitor_creation} from '@/services/create'
import {clean_blueprint} from '@/services/blueprints'
import {vue_error_handler} from '@/services/errors'

import type {Blueprint} from '@/services/types'


// Create app
const app = createApp(AppRoot)
app.config.errorHandler = vue_error_handler
app.component('AppIcon', AppIcon)
app.component('AppHtml', AppHtml)


// Register i18n
const lower_lang = navigator.language.toLowerCase()
let browser_locale = lower_lang.split('-')[0] ?? 'en'
if (browser_locale === 'zh' && ['hant', 'tw', 'hk', 'mo'].includes(lower_lang.split('-')[1] ?? '')){
    browser_locale = 'zh-hant'  // Such countries primarily use traditional script
}
const i18n = createI18n({
    legacy: false,
    locale: browser_locale,
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
void database.connect().then(async () => {

    // Init content state
    content.collection = await content.client.fetch_collection()
    content.translations = content.collection.get_translations({object: true})
    content.languages = content.collection.get_languages({object: true})

    // Load saved state
    const saved = await database.config_get_all()
    state.splash = (saved['splash'] as boolean|undefined) ?? true
    state.advanced = (saved['advanced'] as boolean|undefined) ?? false
    const draft = saved['draft'] as Blueprint|undefined
    Object.assign(blue, clean_blueprint(draft))
    creations.push(...await database.creations_get_all())

    // Start on guide tab if first time
    if (state.splash){
        state.tab = 'help'
    }

    // Start watchers (don't start earlier or will trigger during initially loading some things)
    start_watchers()

    // Mount app
    app.mount('#app')

    // Monitor any creations that were still in progress when last used app
    for (const creation of creations){
        if (creation.status === 'pending'){
            monitor_creation(creation)
        }
    }
})
