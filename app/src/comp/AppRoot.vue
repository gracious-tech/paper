
<template lang='pug'>

DisplaySplash(v-if='state.splash')
v-app.app(v-else)
    v-main

        header
            h1
                BrandIcon.brand
                span Paper Bible
                v-spacer
                VBtn.account(@click='show_account = true' color='' icon variant='text'
                        v-tooltip:left='$t("Account")')
                    AppIcon(name='account_circle')
                v-menu
                    template(#activator='{props}')
                        VBtn(v-bind='props' color='' icon variant='text')
                            AppIcon(name='more_vert')
                    v-list
                        v-list-item(:to='{name: "help"}')
                            template(#prepend)
                                AppIcon(name='auto_stories')
                            v-list-item-title {{ $t("Guide") }}
                        v-list-item(href='https://gracious.tech/donate' target='_blank')
                            template(#prepend)
                                AppIcon(name='donate')
                            v-list-item-title {{ $t("Donate") }}

            AppNavbar(v-if='route.name !== "help"')

        router-view

div.display(v-if='!state.splash')
    DisplayPreview(v-if='showing_editor')
    DisplayDesignVersion(v-else-if='route.name === "design"')
    DisplayHelp(v-else-if='route.name === "help"')

DialogViewedDesign
DialogAcceptInvite
DialogAccount(v-model='show_account')
DialogConfirm
DialogPrompt
DialogCoverEditor
DialogNewDesign

v-snackbar(:model-value='!!state.toast' @update:model-value='state.toast = null' timeout='2500')
    | {{ state.toast }}

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useRoute} from 'vue-router'

import AppNavbar from '@/comp/nav/AppNavbar.vue'
import DialogViewedDesign from '@/comp/dialogs/DialogViewedDesign.vue'
import DialogAcceptInvite from '@/comp/dialogs/DialogAcceptInvite.vue'
import DialogAccount from '@/comp/dialogs/DialogAccount.vue'
import DialogConfirm from '@/comp/dialogs/DialogConfirm.vue'
import DialogPrompt from '@/comp/dialogs/DialogPrompt.vue'
import DialogCoverEditor from '@/comp/dialogs/DialogCoverEditor.vue'
import DialogNewDesign from '@/comp/dialogs/DialogNewDesign.vue'
import DisplaySplash from '@/comp/display/DisplaySplash.vue'
import DisplayPreview from '@/comp/display/DisplayPreview.vue'
import DisplayDesignVersion from '@/comp/display/DisplayDesignVersion.vue'
import DisplayHelp from '@/comp/display/DisplayHelp.vue'
import BrandIcon from '@/assets/icon.svg?component'
import {state} from '@/services/state'
import {design_needs_editor} from '@/services/versions'


const route = useRoute()


// Whether the currently open design is showing its editor (vs. a rendered version) — mirrors
// ViewDesign.vue's own show_editor condition so the sidebar preview matches the main panel
const showing_editor = computed(() => {
    return route.name === 'design' && !route.params['version']
        && (design_needs_editor.value || state.forced_editor)
})


// Whether the account dialog is open
const show_account = ref(false)

</script>


<style lang='sass' scoped>

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
            padding: 12px 12px 0 12px
            margin-bottom: 4px

            > span
                font-family: "Crimson Pro", serif

            .brand
                margin-right: 12px
                width: 36px
                height: 36px


.display
    width: 100%
    height: 100%

    > *
        width: 100%
        height: 100%

    @media (max-width: 900px)
        display: none

</style>
