
// MUST come first
import '@/services/errors.sass'
import '@/services/errors'

// Embed global styles
import './styles.sass'
import 'vuetify/styles'

import {createApp} from 'vue'
import {createVuetify} from 'vuetify'
import {md3} from 'vuetify/blueprints'
import CheckboxBlank from '@material-symbols/svg-400/rounded/check_box_outline_blank.svg'
import Checkbox from '@material-symbols/svg-400/rounded/check_box.svg'
import RadioChecked from '@material-symbols/svg-400/rounded/radio_button_checked.svg'
import RadioUnchecked from '@material-symbols/svg-400/rounded/radio_button_unchecked.svg'
import ExpandMore from '@material-symbols/svg-400/rounded/expand_more.svg'

import AppIcon from './comp/global/AppIcon.vue'
import AppHtml from './comp/global/AppHtml.vue'
import AppRoot from './comp/AppRoot.vue'
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
