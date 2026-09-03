
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

        div(class='d-flex flex-wrap ga-3')
            v-btn(href='https://gracious.tech' target='_blank' variant='tonal')
                | {{$t("view.about.creator")}}
            v-btn(href='https://gracious.tech/contact' target='_blank' variant='tonal')
                | {{$t("app.contact")}}
            v-btn(href='https://github.com/gracious-tech/paper' target='_blank' variant='tonal')
                | {{$t("view.about.source_code")}}

    DisplayHelp.display

</template>


<script lang='ts' setup>

//- The video panel is shared with the help view; on narrow screens it renders inline here
import DisplayHelp from '@/comp/display/DisplayHelp.vue'

//- Inline link to the creator, substituted into the {org} placeholder of the body text
const org_link = '<a href="https://gracious.tech" target="_blank" rel="noopener">Gracious Tech</a>'

</script>


<style lang='sass' scoped>

.cont
    flex-grow: 1
    overflow: auto


.display
    display: none
    width: 100%
    aspect-ratio: 16 / 9
    @media (max-width: 900px)
        display: block

</style>
