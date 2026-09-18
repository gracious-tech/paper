
<template lang='pug'>

div.cont

    h1(class='mb-12')
        BrandIcon
        | Paper Bible

    h2 {{$t("display.splash.tagline")}}
    h2 {{$t("display.splash.languages")}}

    IntroVideo.video

    v-btn(@click='start' color='secondary' size='large' rounded class='my-4') {{$t("display.splash.get_started")}}

</template>


<script lang='ts' setup>

import BrandIcon from '@/assets/icon.svg?component'
import IntroVideo from '@/comp/reuseable/IntroVideo.vue'
import {state} from '@/services/state'


// Dismiss the splash, revealing whatever route the app already booted into (e.g. a shared
// design/invite link the user arrived with) rather than redirecting away from it
const start = () => {
    state.splash = false
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
    padding: 40px 0  // Sides padded per-child so the video can reach the screen edges
    color: white
    text-align: center

    @media (max-width: 1000px)
        h1
            font-size: 40px
            svg
                width: 40px
        h2
            font-size: 18px

h1, h2
    font-family: "Crimson Pro", serif
    padding: 0 16px

h1
    display: flex
    align-items: center
    font-size: 100px
    svg
        width: 100px
        margin-right: 0.5em

h2
    font-size: 24px
    margin-bottom: 24px

.video
    width: 100%
    max-width: 1000px
    aspect-ratio: 16 / 9
    margin: 24px 0
    overflow: hidden

    // Only round the corners when the max-width caps it, otherwise it's spanning the full
    // width of the screen and should meet the edges cleanly
    @media (min-width: 1000px)
        border-radius: 16px

</style>
