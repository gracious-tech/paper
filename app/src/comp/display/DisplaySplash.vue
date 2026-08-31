
<template lang='pug'>

div.cont

    h1
        BrandIcon
        | Paper Bible

    img(src='@/assets/splash.webp')

    h2 {{$t("display.splash.tagline")}}
    h2 {{$t("display.splash.languages")}}

    v-btn(@click='start' color='secondary' size='large' rounded class='my-4') {{$t("display.splash.get_started")}}

</template>


<script lang='ts' setup>

import {useRouter} from 'vue-router'

import BrandIcon from '@/assets/icon.svg?component'
import {state} from '@/services/state'
import {designs} from '@/services/designs'


const router = useRouter()


// Dismiss the splash, revealing whatever route the app already booted into (e.g. a shared
// design/invite link the user arrived with) rather than redirecting away from it. Brand-new
// users who arrived at the app itself (no designs, plain /designs route) go straight into the
// new-design wizard for their first design
const start = () => {
    state.splash = false
    if (!designs.length && router.currentRoute.value.name === 'designs'){
        state.new_design = true
    }
}


</script>


<style lang='sass' scoped>


.cont
    background-color: rgb(var(--v-theme-primary))
    overflow-y: auto
    display: flex
    width: 100%
    flex-direction: column
    align-items: center
    padding: 40px 16px
    color: white
    text-align: center

    @media (max-width: 1000px)
        h1
            font-size: 40px
            svg
                width: 40px

h1, h2
    font-family: "Crimson Pro", serif

h1
    display: flex
    align-items: center
    font-size: 100px
    svg
        width: 100px
        margin-right: 0.5em

h2
    font-size: 24px

img
    width: 100%
    max-width: 60vh  // So less likely to require scrolling on short screens
    margin: 48px
    border-radius: 2px

</style>
