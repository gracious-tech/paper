
<template lang='pug'>

DisplaySplash(v-if='state.splash')
v-app.app(v-else)
    v-main

        header
            h1
                BrandIcon.brand
                span Paper Bible
                v-spacer
                VBtn.donate(href='https://gracious.tech/donate' target='_blank' color='' icon
                        variant='text' v-tooltip:left='"Donate"')
                    AppIcon(name='donate')

            v-tabs(v-model='state.tab' grow color='secondary-lighten-2')
                v-tab(rounded='0' value='create') {{$t("Design")}}
                v-tab(rounded='0' value='history') {{$t("Creations")}}
                v-tab(rounded='0' value='help') {{$t("Guide")}}

        v-window(v-model='state.tab')

            v-window-item(value='create')
                TabEditor(v-if='state.editor')
                TabCreate(v-else)

            v-window-item(value='history')
                TabHistory

            v-window-item(value='help')
                TabHelp

div.display(v-if='!state.splash')
    DisplayPreview(v-if='state.tab === "create"')
    DisplayCreation(v-else-if='state.tab === "history"')
    DisplayHelp(v-else-if='state.tab === "help"')

</template>


<script lang='ts' setup>

import TabCreate from '@/comp/tabs/TabCreate.vue'
import TabHelp from '@/comp/tabs/TabHelp.vue'
import TabHistory from '@/comp/tabs/TabHistory.vue'
import TabEditor from '@/comp/tabs/TabEditor.vue'
import DisplaySplash from '@/comp/display/DisplaySplash.vue'
import DisplayPreview from '@/comp/display/DisplayPreview.vue'
import DisplayCreation from '@/comp/display/DisplayCreation.vue'
import DisplayHelp from '@/comp/display/DisplayHelp.vue'
import BrandIcon from '@/assets/icon.svg?component'
import {state} from '@/services/state'

</script>


<style lang='sass' scoped>

.v-application
    background-color: hsl(325, 15%, 90%)
    min-width: 500px
    @media (max-width: 900px)
        min-width: auto
        max-width: none
        width: 100%
    max-width: 500px

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

            .donate svg
                width: 30px
                height: 30px

    h2
        margin-top: 24px

    .v-window
        display: flex  // Needed for webkit
        flex-direction: column  // Needed for webkit
        flex-grow: 1

        :deep()
            .v-window__container
                height: 100%
                flex-grow: 1

            .v-window-item
                display: flex
                flex-direction: column
                height: 100%
                flex-grow: 1

.display
    width: 100%
    height: 100%

    > *
        width: 100%
        height: 100%

    @media (max-width: 900px)
        display: none

</style>
