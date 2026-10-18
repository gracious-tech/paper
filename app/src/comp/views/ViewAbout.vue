
<template lang='pug'>

div.cont(class='text-body-medium')

    div(class='ma-6')

        //- Back to home
        v-btn.back(:to='{name: "designs"}' variant='tonal' class='mb-6')
            template(#prepend)
                AppIcon(name='arrow_back')
            | {{$t("common.home")}}

        p(class='text-body-large mb-4') {{$t("view.about.intro")}}

        p(class='text-body-large mb-4' v-html='$t("view.about.body", {org: org_link})')

        p(class='text-body-large mb-4') {{$t("view.about.license")}}

        //- Each group of links under its own subheading, the buttons side by side
        template(v-for='section of sections' :key='section.title')
            h2(class='text-title-large mb-2') {{ section.title }}
            div(class='d-flex flex-wrap ga-3 mb-6')
                v-btn(v-for='link of section.links' :key='link.label' :href='link.href'
                        :to='link.to' :target='link.href ? "_blank" : undefined' variant='tonal')
                    | {{ link.label }}

    //- Only mounted on mobile, where AppRoot's display area isn't (rather than hidden by CSS):
    //- a second copy of the embed would load and autoplay unseen once the visible one is clicked
    IntroVideo.video(v-if='is_mobile')

    //- The build's commit, so a user reporting a problem can say which release they're on
    p(class='text-body-small text-medium-emphasis ma-6') {{$t("view.about.version", {build})}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {useI18n} from '@/services/i18n'
import {use_is_mobile} from '@/services/display'
// The video panel is shared with the display area; on narrow screens it renders inline here
import IntroVideo from '@/comp/reuseable/IntroVideo.vue'

import type {RouteLocationRaw} from 'vue-router'


// A button in a link group: an outside page (opened in a new tab) or a route within the app
interface AboutLink {
    label:string
    href?:string
    to?:RouteLocationRaw
}

const {t} = useI18n()

// Same breakpoint AppRoot uses to decide whether its display area (and its video) is mounted
const is_mobile = use_is_mobile()

// The page's link groups, computed so the labels follow a change of locale
const sections = computed(():{title:string, links:AboutLink[]}[] => [
    {title: t('view.about.about_us'), links: [
        {label: t('view.about.creator'), href: 'https://gracious.tech'},
        {label: t('view.about.funding'), href: 'https://gracious.tech/donate'},
        {label: t('app.contact'), href: 'https://gracious.tech/contact'},
    ]},
    {title: t('view.about.about_app'), links: [
        {label: t('view.about.publishers'), to: {name: 'publishers'}},
        {label: t('view.about.source_code'), href: 'https://github.com/gracious-tech/paper'},
    ]},
    {title: t('view.about.legal'), links: [
        {label: t('app.privacy'), to: {name: 'privacy'}},
    ]},
])

//- Inline link to the creator, substituted into the {org} placeholder of the body text
const org_link = '<a href="https://gracious.tech" target="_blank" rel="noopener">Gracious Tech</a>'

//- Short commit hash the app was built from (see vite.config.mts)
const build = import.meta.env.BUILD_COMMIT

</script>


<style lang='sss' scoped>

.cont
    flex-grow: 1
    overflow: auto


.video
    width: 100%
    aspect-ratio: 16 / 9

</style>
