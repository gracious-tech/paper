
<template lang='pug'>

div.cont

    h1
        BrandIcon
        | Paper Bible

    img(src='@/assets/splash.webp')

    h2 Print books of the Bible in whatever style you need
    h2 In over 800 languages

    v-btn(@click='start' color='secondary' size='large' rounded class='my-4') Get Started

</template>


<script lang='ts' setup>

import BrandIcon from '@/assets/icon.svg?component'
import {database} from '@/services/db'
import {state} from '@/services/state'


const start = () => {
    database.config_set('splash', false)
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
