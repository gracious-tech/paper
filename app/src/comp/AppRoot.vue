
<template lang='pug'>

DisplaySplash(v-if='state.splash')
v-app.app(v-else)
    v-main

        header
            h1
                router-link.brand_link(:to='{name: "designs"}')
                    BrandIcon.brand
                    span Paper Bible
                span.beta beta
                v-spacer
                //- Filled and green once signed in; struck-through and flagged while a guest,
                //- since guest work lives only in this browser and is easily lost
                //- TODO Show the user's profile picture here instead when they have one
                VBtn.account(@click='state.account = true' icon variant='text'
                        :class='{guest: is_anonymous}'
                        :color='is_anonymous ? "" : "success-light"'
                        v-tooltip:left='is_anonymous ? $t("app.account_guest") : $t("common.account")')
                    AppIcon(:name='is_anonymous ? "no_accounts" : "account_circle_fill"')
                v-menu
                    template(#activator='{props}')
                        VBtn(v-bind='props' color='' icon variant='text')
                            AppIcon(name='more_vert')
                    v-list
                        v-list-item(:to='{name: "about"}')
                            template(#prepend)
                                AppIcon(name='info')
                            v-list-item-title {{ $t("app.about") }}
                        v-list-item(href='https://gracious.tech/contact' target='_blank')
                            template(#prepend)
                                AppIcon(name='mail')
                            v-list-item-title {{ $t("app.contact") }}
                        v-list-item(href='https://gracious.tech/donate' target='_blank')
                            template(#prepend)
                                AppIcon(name='donate')
                            v-list-item-title {{ $t("app.donate") }}

            AppNavbar(v-if='route.name !== "about" && route.name !== "privacy"')

        router-view

div.display(v-if='!state.splash')
    DisplayPreview(v-if='showing_editor')
    DisplayDesignVersion(v-else-if='route.name === "design"')
    IntroVideo(v-else-if='route.name === "about"')
    DisplayExamples(v-else-if='route.name === "designs"')

DialogViewedDesign
DialogAcceptInvite
DialogAccount(v-model='state.account')
DialogConfirm
DialogPrompt
DialogAlert
DialogCoverEditor
DialogNewDesign
DialogPageSuggestions
DialogHowToPrint
DialogEstimateCost
DialogPrintServiceWarning
//- LEGACY Remove with app/src/legacy/ once old data no longer needs recovering
DialogLegacy

v-snackbar(:model-value='!!state.toast' @update:model-value='state.toast = null' timeout='2500')
    | {{ state.toast }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useRoute} from 'vue-router'
import {useI18n} from '@/services/i18n'

import AppNavbar from '@/comp/nav/AppNavbar.vue'
import DialogViewedDesign from '@/comp/dialogs/DialogViewedDesign.vue'
import DialogAcceptInvite from '@/comp/dialogs/DialogAcceptInvite.vue'
import DialogAccount from '@/comp/dialogs/DialogAccount.vue'
import DialogConfirm from '@/comp/dialogs/DialogConfirm.vue'
import DialogPrompt from '@/comp/dialogs/DialogPrompt.vue'
import DialogAlert from '@/comp/dialogs/DialogAlert.vue'
import DialogCoverEditor from '@/comp/dialogs/DialogCoverEditor.vue'
import DialogNewDesign from '@/comp/dialogs/DialogNewDesign.vue'
import DialogPageSuggestions from '@/comp/dialogs/DialogPageSuggestions.vue'
import DialogHowToPrint from '@/comp/dialogs/DialogHowToPrint.vue'
import DialogEstimateCost from '@/comp/dialogs/DialogEstimateCost.vue'
import DialogPrintServiceWarning from '@/comp/dialogs/DialogPrintServiceWarning.vue'
import DisplaySplash from '@/comp/display/DisplaySplash.vue'
import DisplayPreview from '@/comp/display/DisplayPreview.vue'
import DisplayDesignVersion from '@/comp/display/DisplayDesignVersion.vue'
import DisplayExamples from '@/comp/display/DisplayExamples.vue'
import IntroVideo from '@/comp/reuseable/IntroVideo.vue'
import BrandIcon from '@/assets/icon.svg?component'
// LEGACY Remove with app/src/legacy/ once old data no longer needs recovering
import DialogLegacy from '@/legacy/DialogLegacy.vue'
import {probe_legacy_data} from '@/legacy/legacy'
import {state} from '@/services/state'
import {is_anonymous} from '@/services/auth'
import {design_needs_editor} from '@/services/versions'
import {init_coloris} from '@/services/coloris'


const route = useRoute()
const {t} = useI18n()


// Bind the Coloris color picker to every [data-coloris] input (AppColor), once, app-wide
init_coloris(t("app.used_in_design"))


// LEGACY Detect data from the previous app, revealing ViewDesigns' "My Old Docs" button.
// Probed here (once at boot) rather than in ViewDesigns, which remounts on every visit
void probe_legacy_data()


// Whether the currently open design is showing its editor (vs. a rendered version) — mirrors
// ViewDesign.vue's own show_editor condition so the sidebar preview matches the main panel
const showing_editor = computed(() => {
    return route.name === 'design' && !route.params['version']
        && (design_needs_editor.value || state.forced_editor)
})

</script>


<style lang='sss' scoped>

.v-application
    --app-bg: hsl(325, 15%, 90%)
    background-color: var(--app-bg)
    min-width: 500px
    max-width: 500px
    @media (max-width: 900px)
        min-width: auto
        max-width: none
        width: 100%

    .v-main
        display: flex
        flex-direction: column
        height: 100%

    header
        background-color: rgb(var(--v-theme-primary))
        color: rgb(var(--v-theme-on-primary))

        h1
            display: flex
            align-items: center
            padding: 6px 6px 0 12px
            margin-bottom: 4px
            font-size: 24px

            .brand_link
                display: flex
                align-items: center
                color: inherit
                text-decoration: none

                span
                    font-family: "Crimson Pro", serif
                    transition: color 0.15s ease

                .brand
                    margin-right: 12px
                    width: 28px
                    height: 28px

                &:hover span
                    color: rgb(var(--v-theme-secondary-lighten-2))

            .beta
                margin-left: 10px
                margin-top: 14px
                border-radius: 10px
                color: #fffa
                font-family: inherit
                font-size: 10px
                font-weight: 600
                text-transform: uppercase
                letter-spacing: 0.5px
                align-self: flex-start
                user-select: none

            // Flag the guest state with a dot, pulsing a few times on load to catch the eye
            // without nagging for the rest of the session
            // WARN Must be ::before — Vuetify styles .v-btn::after as its focus ring, and its
            // opacity/left would still apply to any properties this rule doesn't set
            .account.guest::before
                content: ''
                position: absolute
                top: 7px
                right: 7px
                // Sits above the button's overlay/underlay layers
                z-index: 1
                // content-box so the ring below adds to the dot rather than eating into it
                box-sizing: content-box
                width: 10px
                height: 10px
                border-radius: 50%
                background-color: rgb(var(--v-theme-warning))
                // Ring in the header colour, so the dot reads as separate from the icon
                border: 2px solid rgb(var(--v-theme-primary))
                animation: guest_pulse 1.6s ease-out 3

                @media (prefers-reduced-motion: reduce)
                    animation: none

@keyframes guest_pulse
    0%
        box-shadow: 0 0 0 0 rgba(var(--v-theme-warning), 0.7)
    70%
        box-shadow: 0 0 0 9px rgba(var(--v-theme-warning), 0)
    100%
        box-shadow: 0 0 0 0 rgba(var(--v-theme-warning), 0)


.display
    width: 100%
    height: 100%

    > *
        width: 100%
        height: 100%

    @media (max-width: 900px)
        display: none

</style>
